import { Request, Response } from "express";
import { User } from "../entities/entities/User";
import { AppDataSource } from "../db";
import { Like } from "typeorm";
import { ChatbotService } from "../services/chatbot.service";
import { Recipe } from "../entities/entities/Recipe";
import { Like as LikeRepo } from "../entities/entities/Like";
import { EmbeddingsService } from "../services/embeddings.service";
import { OllamaService } from "../services/ollama.service";
import { LangchainChatService } from "../services/langchain.service";
import { LlmService } from "../services/llm.service";
import { MilvusService } from "../services/milvus.service";
import { NO_RECIPES_FOUND_MESSAGE } from "../constants";
import { OllamaRAGService } from "../services/ollama-rag.service";
import { runRecipeAgent } from "../tools/agent-runner";

const ApiKey = process.env.AI_KEY;

export class UserController {
  static async search(req: Request, res: Response) {
    try {
      const { user } = req.query;

      const userRepository = AppDataSource.getRepository(User);
      const data = await userRepository
        .find({
          where: {
            username: Like(`%${user}%`),
          },
        })
        .catch((err) => console.log(err));
      if (!data) {
        return res.status(404).json({
          message: "User not found",
        });
      }
      res.status(200).json({
        message: "User searched successfully",
        users: data,
      });
    } catch (error) {
      res.status(500).json({
        message: "Internal server error",
        error: error,
      });
    }
  }
  static async generateVector(req: Request, res: Response) {
    try {
      const queryRunner = AppDataSource.createQueryRunner();
      await queryRunner.connect();
      try {
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector;`);
        await queryRunner.query(
          `ALTER TABLE recipe ADD COLUMN IF NOT EXISTS embedding vector(768);`
        );
        await queryRunner.query(
          `CREATE INDEX IF NOT EXISTS recipe_embedding_idx ON recipe USING ivfflat (embedding vector_cosine_ops);`
        );
        res.status(200).json({
          message:
            "Vector extension enabled, embedding column added, and index created successfully.",
        });
      } finally {
        await queryRunner.release();
      }
    } catch (error) {
      res.status(500).json({
        message: "Internal server error",
        error: error,
      });
    }
  }
  static async chat(req: Request, res: Response) {
    try {
      const { username } = req.params;
      const { message } = req.body;
      const userRepository = AppDataSource.getRepository(User);
      const data = await userRepository
        .findOne({
          where: {
            username: Like(`%${username}%`),
          },
        })
        .catch((err) => console.log(err));
      if (!data) {
        return res.status(404).json({
          message: "User not found",
        });
      }
      const userId = data.uid;
      const chatbotService = new ChatbotService();

      const aiResponse = await chatbotService.ask(userId, message);

      return res.status(200).json({
        user: username,
        question: message,
        response: aiResponse,
      });
    } catch (error) {
      res.status(500).json({
        message: "Internal server error",
        error: error,
      });
    }
  }
  static async getUserResponse(req: Request, res: Response) {
    try {
      const [UserRepository, RecipeRepository, LikeRepository] =
        await Promise.all([
          AppDataSource.getRepository(User),
          AppDataSource.getRepository(Recipe),
          AppDataSource.getRepository(LikeRepo),
        ]);
      const { username } = req.params;

      const user = await UserRepository.findOne({
        where: {
          username: Like(`%${username}%`),
        },
      });
      if (!user) {
        return res.status(404).json({
          message: "User not found",
        });
      }

      const [results, likedRecipes] = await Promise.all([
        RecipeRepository.find({
          where: {
            userU: {
              uid: user.uid,
            },
          },
        }),
        RecipeRepository.createQueryBuilder("recipe")
          .innerJoin(
            LikeRepo,
            "lk",
            '"lk"."entityType" = :entityType AND "lk"."userUid" = :uid AND "recipe"."id"::text = "lk"."entityId"',
            { entityType: "recipe", uid: user.uid }
          )
          .getMany(),
      ]);
      return res.status(200).json({
        userRecipes: results,
        likedRecipes,
        user,
      });
    } catch (error) {
      res.status(500).json({
        message: "Internal server error",
        error: error,
      });
    }
  }

  static async generateEmbeddings(req: Request, res: Response) {
    try {
      const embeddingsService = new EmbeddingsService();
      const { username } = req.params;

      // First find the user
      const user = await AppDataSource.query(
        `SELECT uid FROM "user" WHERE username = $1`,
        [username]
      );

      if (!user || user.length === 0) {
        return res.status(404).json({
          message: "User not found",
        });
      }

      const userUid = user[0].uid;

      // Get this user's recipes (own + liked) that need embeddings
      const recipes = await AppDataSource.query(
        `
          SELECT DISTINCT r.id, r.name as recipe_name, r.ingress, r.difficulty, r.servings, r."prepTime", r."cookTime"
          FROM recipe r
          WHERE (
            r."userUid" = $1 OR EXISTS (
              SELECT 1 FROM user_likes_recipe ulr 
              WHERE ulr."recipeId" = r.id AND ulr."userUid" = $1
            )
          )
            AND r.status = 'published' 
            AND r."deletedAt" IS NULL
            AND r.embedding IS NULL
          ORDER BY r.id
          `,
        [userUid]
      );

      console.log("recipes", recipes, "here is recipes");

      // Process each recipe individually to avoid complex joins
      const recipesToProcess = [];

      for (const recipe of recipes) {
        // Get ingredients for this recipe
        const ingredients = await AppDataSource.query(
          `
          SELECT ri.amount, ri.section, ri."order" as ingredient_order,
                 i.name as ingredient_name,
                 mut.name as measuring_unit_name
          FROM recipe_ingredient ri
          LEFT JOIN ingredient i ON ri."ingredientId" = i.id
          LEFT JOIN measuring_unit mu ON ri."unitId" = mu.id
          LEFT JOIN measuring_unit_translation mut ON mu.id = mut."measuringUnitId"
          WHERE ri."recipeId" = $1
          ORDER BY ri."order"
          `,
          [recipe.id]
        );

        // Get instructions for this recipe
        const instructions = await AppDataSource.query(
          `
          SELECT description, "order" as instruction_order
          FROM recipe_instruction
          WHERE "recipeId" = $1
          ORDER BY "order"
          `,
          [recipe.id]
        );

        recipesToProcess.push({
          id: recipe.id,
          name: recipe.recipe_name,
          ingress: recipe.ingress,
          difficulty: recipe.difficulty,
          servings: recipe.servings,
          prepTime: recipe.prepTime,
          cookTime: recipe.cookTime,
          ingredients: ingredients.map((ing: any) => ({
            name: ing.ingredient_name,
            amount: ing.amount,
            unit: ing.measuring_unit_name,
            order: ing.ingredient_order,
          })),
          instructions: instructions.map((inst: any) => ({
            description: inst.description,
            order: inst.instruction_order,
          })),
        });
      }
      let processed = 0;
      let errors = 0;

      for (const recipe of recipesToProcess) {
        try {
          // Prepare recipe text for embedding
          const recipeText = embeddingsService.prepareRecipeText(recipe);

          // Generate embedding
          const embedding = await embeddingsService.generateEmbedding(
            recipeText
          );

          // Store embedding in database
          await AppDataSource.query(
            `UPDATE recipe SET embedding = $1 WHERE id = $2`,
            [JSON.stringify(embedding), recipe.id]
          );

          processed++;
          console.log(
            `Processed recipe ${recipe.name} (${processed}/${recipesToProcess.length})`
          );
        } catch (error) {
          console.error(`Error processing recipe ${recipe.name}:`, error);
          errors++;
        }
      }

      res.status(200).json({
        message: "Embeddings generation completed",
        processed,
        errors,
        total: recipesToProcess.length,
      });
    } catch (error) {
      res.status(500).json({
        message: "Internal server error",
        error: error,
      });
    }
  }

  static async generateEmbeddingsOllama(req: Request, res: Response) {
    try {
      const { username } = req.params;
      const ollama = new OllamaService();

      const user = await AppDataSource.query(
        `SELECT uid FROM "user" WHERE username = $1`,
        [username]
      );
      if (!user || user.length === 0) {
        return res.status(404).json({ message: "User not found" });
      }
      const userUid = user[0].uid;

      const RecipeRepository = AppDataSource.getRepository(Recipe);

      const likedRecipes = await RecipeRepository.createQueryBuilder("recipe")
        .innerJoin(
          LikeRepo,
          "lk",
          '"lk"."entityType" = :entityType AND "lk"."userUid" = :uid AND "recipe"."id"::text = "lk"."entityId"',
          { entityType: "recipe", uid: user.uid }
        )
        .getMany();

      const recipes = await AppDataSource.query(
        `
         SELECT DISTINCT r.id, r.name AS recipe_name, r.ingress, r.difficulty, r.servings, r."prepTime", r."cookTime"
FROM recipe r
WHERE (
  r."userUid" = $1
  OR EXISTS (
    SELECT 1
    FROM "like" lk
    WHERE lk."userUid" = $1
      AND lk."entityType" = 'recipe'
      AND lk."entityId" = r.id::text
  )
)
AND r.status = 'published'
AND r."deletedAt" IS NULL
AND r.embedding IS NULL
ORDER BY r.id
          `,
        [userUid]
      );

      let processed = 0;
      let errors = 0;
      for (const r of recipes) {
        try {
          const ingredients = await AppDataSource.query(
            `
            SELECT ri.amount, ri.section, ri."order" as ingredient_order,
                   i.name as ingredient_name,
                   mut.name as measuring_unit_name
            FROM recipe_ingredient ri
            LEFT JOIN ingredient i ON ri."ingredientId" = i.id
            LEFT JOIN measuring_unit mu ON ri."unitId" = mu.id
            LEFT JOIN measuring_unit_translation mut ON mu.id = mut."measuringUnitId"
            WHERE ri."recipeId" = $1
            ORDER BY ri."order"
            `,
            [r.id]
          );

          const instructions = await AppDataSource.query(
            `
            SELECT description, "order" as instruction_order
            FROM recipe_instruction
            WHERE "recipeId" = $1
            ORDER BY "order"
            `,
            [r.id]
          );

          const textParts: string[] = [];
          textParts.push(`Recipe: ${r.recipe_name}`);
          if (r.ingress) textParts.push(`Description: ${r.ingress}`);
          if (r.difficulty) textParts.push(`Difficulty: ${r.difficulty}`);
          if (r.servings) textParts.push(`Serves: ${r.servings}`);
          const totalTime = (r.prepTime || 0) + (r.cookTime || 0);
          if (totalTime) textParts.push(`Total time: ${totalTime} minutes`);
          if (ingredients.length) {
            textParts.push(
              `Ingredients: ${ingredients
                .map(
                  (ing: any) =>
                    `${ing.amount ? ing.amount + " " : ""}${
                      ing.measuring_unit_name
                        ? ing.measuring_unit_name + " "
                        : ""
                    }${ing.ingredient_name}`
                )
                .join(", ")}`
            );
          }
          if (instructions.length) {
            textParts.push(
              `Instructions: ${instructions
                .sort(
                  (a: any, b: any) => a.instruction_order - b.instruction_order
                )
                .map((i: any) => i.description)
                .join(" ")}`
            );
          }

          const embedding = await ollama.embed(textParts.join("\n"));
          console.log("embedding", embedding, textParts, "here is embedding");
          if (!embedding || embedding.length === 0) {
            throw new Error("Received empty embedding from Ollama");
          }
          const vectorLiteral = `[${embedding.join(",")}]`;
          await AppDataSource.query(
            `UPDATE recipe SET embedding = $1::vector WHERE id = $2`,
            [vectorLiteral, r.id]
          );
          processed++;
        } catch (e) {
          console.error("ollama embedding error", e);
          errors++;
        }
      }

      return res.status(200).json({
        message: "Ollama embeddings completed",
        processed,
        errors,
        total: recipes.length,
      });
    } catch (error) {
      res.status(500).json({ message: "Internal server error", error });
    }
  }

  static async chatAI(req: Request, res: Response) {
    try {
      const { username } = req.params;
      const { message, model } = req.body;
      const llmService = new LlmService();
      let timeToCheckTopic = 0;

      const user = await AppDataSource.query(
        `SELECT uid FROM "user" WHERE username = $1`,
        [username]
      );
      if (!user || user.length === 0) {
        return res.status(404).json({ message: "User not found" });
      }
      const userUid = user[0].uid;
      const lc = new LangchainChatService();
      const history = await lc.getPreviousMessages(userUid);
      const lastAIMessage = history
        .filter((m: any) => m._getType() === "ai")
        .slice(-1)[0];

      const lastAIContent = lastAIMessage
        ? typeof lastAIMessage.content === "string"
          ? lastAIMessage.content
          : String(lastAIMessage.content)
        : null;

      const topicCheckStartTime = Date.now();
      const topicCheckPrompt = lastAIContent
        ? `You are checking if a conversation is about food/recipes/cooking.
      
      Previous assistant message: "${lastAIContent}"
      User's reply: "${message}"
      
      Is this conversation about food, recipes, cooking, ingredients, or meal planning?
      Reply only with "YES" if it is food-related or a continuation of the food conversation.
      Otherwise reply only with "NO".
      
      Answer (YES or NO):`
        : `Decide if the user message is about food, recipes, cooking, ingredients, or meal planning.
      Reply only with "YES" if it is food-related.
      Otherwise, reply only with "NO".
      
      Answer (YES or NO):
      User message: "${message}"
      `;
      const ragService = new OllamaRAGService();
      const ragResult = await ragService.runRAG(message, userUid);

      if (ragResult.similarRecipesFromMilvus.length === 0) {
        const response = await llmService.chat(
          "",
          NO_RECIPES_FOUND_MESSAGE + "${message}",
          []
        );
        return res.status(200).json({
          response: response,
          debug: {
            message: "No recipes found in Milvus",
            recipeIds: [],
          },
        });
      }

      const aiResponseResult = await ragService.formatAIResponse(
        message,
        userUid,
        model,
        ragResult
      );

      return res.status(200).json({
        response: aiResponseResult.content,
        previousMessages: aiResponseResult.previousMessages,
        debug: {
          model,
          completion: aiResponseResult.completion,
          question: message,
          context: ragResult.context,
          conversationContext: aiResponseResult.conversationContext,
          embeddingGenerated: true,
          userIngredients: ragResult.userIngredients,
          calculationMethod: "Milvus Vector Search + PostgreSQL Details",
          milvusResults: ragResult.similarRecipesFromMilvus.length,
          recipesFromDB: ragResult.recipes.length,
          systemPrompt: aiResponseResult.systemPrompt,
          time: {
            timeToCheckTopic: timeToCheckTopic / 1000,
            timeToGenerateEmbedding: ragResult.timeToGenerateEmbedding / 1000,
            timeToQuery: ragResult.timeToQuery / 1000,
            timeToGenerateAIResponse:
              aiResponseResult.timeToGenerateAIResponse / 1000,
          },
          relevantRecipesFound: ragResult.similarRecipes.length,
          topRelevantRecipes: ragResult.similarRecipes.map((r: any) => ({
            name: r.recipe_name,
            type: r.recipe_type,
            similarity: `${r.similarity?.toFixed(1)}%`,
          })),
          similarRecipesFromMilvus: ragResult.similarRecipesFromMilvus,
        },
      });
    } catch (error) {
      console.error("Chat error:", error);
      res.status(500).json({
        message: "Internal server error",
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  static async generateEmbeddingsOllamaAll(req: Request, res: Response) {
    try {
      const ollama = new OllamaService();
      let processed = 0,
        errors = 0;
      const recipes = await AppDataSource.query(
        `SELECT id, name, ingress, difficulty, servings, "prepTime", "cookTime" FROM recipe`
      );
      for (const recipe of recipes) {
        try {
          const ingredientsRows = await AppDataSource.query(
            `
            SELECT i.name
            FROM recipe_ingredient ri
            INNER JOIN ingredient i ON ri."ingredientId" = i.id
            WHERE ri."recipeId" = $1
            ORDER BY ri."order"
            `,
            [recipe.id]
          );

          let tagNames: string[] = [];
          try {
            const tags = await AppDataSource.query(
              `
              SELECT t.name
              FROM tag t
              INNER JOIN recipe_tags_tag rtt ON rtt."tagId" = t.id
              WHERE rtt."recipeId" = $1
              `,
              [recipe.id]
            );
            tagNames = (tags || []).map((t: any) => t.name).filter(Boolean);
          } catch (__) {
            tagNames = [];
          }

          const ingredientNames: string[] = (ingredientsRows || [])
            .map((r: any) => r.name)
            .filter(Boolean);

          const parts: string[] = [];
          parts.push(`Recipe: ${recipe.name}`);
          if (recipe.ingress) parts.push(`Description: ${recipe.ingress}`);
          if (Array.isArray(tagNames) && tagNames.length > 0)
            parts.push(`Tags: ${tagNames.join(", ")}`);
          if (ingredientNames.length > 0)
            parts.push(`Ingredients: ${ingredientNames.join(", ")}`);
          if (recipe.difficulty) parts.push(`Difficulty: ${recipe.difficulty}`);
          if (recipe.servings) parts.push(`Serves: ${recipe.servings}`);
          const totalTime = (recipe.prepTime || 0) + (recipe.cookTime || 0);
          if (totalTime) parts.push(`TotalTimeMin: ${totalTime}`);

          const embeddingText = parts.join("\n");

          const embedding = await ollama.embed(embeddingText);
          if (!embedding || embedding.length === 0) {
            errors++;
            continue;
          }

          processed++;
          const vectorLiteral = `[${embedding.join(",")}]`;
          await AppDataSource.query(
            `UPDATE recipe SET embedding = $1::vector WHERE id = $2`,
            [vectorLiteral, recipe.id]
          );
        } catch (e) {
          errors++;
        }
      }
      console.info("Embeddings generation completed", {
        processed,
        errors,
        total: recipes.length,
      });
      return res.status(200).json({
        message: "Embeddings generation completed",
        processed,
        errors,
        total: recipes.length,
      });
    } catch (error) {
      console.error("Embeddings generation error:", error);
      res.status(500).json({
        message: "Internal server error",
        error: error,
      });
    }
  }

  static async getChatHistory(req: Request, res: Response) {
    try {
      const { username } = req.params;
      const user = await AppDataSource.query(
        `SELECT uid FROM "user" WHERE username = $1`,
        [username]
      );
      if (!user || user.length === 0) {
        return res.status(404).json({ message: "User not found" });
      }
      const userUid = user[0].uid;

      const lc = new LangchainChatService();
      const previousMessages = await lc.getPreviousMessages(userUid);

      return res.status(200).json({
        username,
        userUid,
        previousMessages,
      });
    } catch (error) {
      res.status(500).json({ message: "Internal server error", error });
    }
  }

  static async getRecipes(req: Request, res: Response) {
    try {
      console.log("call received", req.params.userId);
      const ragService = new OllamaRAGService();
      const lc = new LangchainChatService();
      const { query } = req.body;
      const { userId } = req.params;

      console.log({ query, userId });
      const [ragResult, previousMessages] = await Promise.all([
        ragService.runRAG(query, userId ?? "00DLyaukerYEGpYXYF3ALnSJc0a2"),
        lc.getPreviousMessages(userId),
      ]);

      const recipes = ragResult.similarRecipes;
      console.log(recipes);
      const safeRecipesForVapi = recipes
        .sort((a: any, b: any) => a.similarity - b.similarity)
        .map((recipe) => {
          return {
            recipe_name: recipe.recipe_name,
            description: recipe.ingress ?? "",
            difficulty: recipe.difficulty,
            cookTime: recipe.cookTime,
            ingredients: recipe.ingredients?.map((ingredient: any) => {
              return {
                name: ingredient.name,
                amount: ingredient.amount,
                unit: ingredient.unit,
                order: ingredient.order,
              };
            }),
            instructions: recipe.instructions
              ?.sort((a: any, b: any) => a.order - b.order)
              .map((instruction: any) => instruction.description),
          };
        });
      console.log(safeRecipesForVapi);
      return res.status(200).json({
        recipes: safeRecipesForVapi,
        noResults: !recipes.length || recipes.length === 0,
        previousContext: previousMessages?.map((item) => {
          return {
            text: item?.content ?? "",
            role: item?._getType() === "human" ? "user" : "assistant",
          };
        }),
      });
    } catch (error) {
      console.log(error);
      res.status(500).json({ message: "Internal server error", error });
    }
  }

  static async searchWithAgent(req: Request, res: Response) {
    try {
      const { message } = req.body;

      if (!message || typeof message !== "string") {
        return res.status(400).json({
          message: "Bad request",
          error: "Message is required in request body",
        });
      }

      console.log("[Controller] Received agent search request:", message);

      const result = await runRecipeAgent(message);

      return res.status(200).json({
        recipes: result.recipes,
        noResults: result.noResults,
        count: result.recipes.length,
      });
    } catch (error) {
      console.error("[Controller] Error in searchWithAgent:", error);
      res.status(500).json({
        message: "Internal server error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
