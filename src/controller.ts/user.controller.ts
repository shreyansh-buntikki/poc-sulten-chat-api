import { Request, Response } from "express";
import { User } from "../entities/entities/User";
import { AppDataSource } from "../db";
import { Like } from "typeorm";
import { ChatbotService } from "../services/chatbot.service";
import { Recipe } from "../entities/entities/Recipe";
import { Like as LikeRepo } from "../entities/entities/Like";
import { EmbeddingsService } from "../services/embeddings.service";
import { OllamaService } from "../services/ollama.service";

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

      const results = await RecipeRepository.find({
        where: {
          userU: {
            uid: user.uid,
          },
        },
      });
      const likedRecipes = await RecipeRepository.createQueryBuilder("recipe")
        .innerJoin(
          LikeRepo,
          "lk",
          '"lk"."entityType" = :entityType AND "lk"."userUid" = :uid AND "recipe"."id"::text = "lk"."entityId"',
          { entityType: "recipe", uid: user.uid }
        )
        .getMany();
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

  static async chatOllama(req: Request, res: Response) {
    try {
      const { username } = req.params;
      const { message } = req.body;
      const ollama = new OllamaService();

      const user = await AppDataSource.query(
        `SELECT uid FROM "user" WHERE username = $1`,
        [username]
      );
      if (!user || user.length === 0) {
        return res.status(404).json({ message: "User not found" });
      }
      const userUid = user[0].uid;

      // Generate question embedding once
      const questionEmbedding = await ollama.embed(message);
      if (!questionEmbedding || questionEmbedding.length === 0) {
        throw new Error("Failed to generate question embedding");
      }

      // Build pgvector literal and dessert cue flag
      const vectorLiteral = `[${questionEmbedding.join(",")}]`;
      const hasDessertCue = /cake|dessert|sweet/i.test(message);

      // Single SQL with similarity and boosts; robust liked detection via polymorphic like table
      const similarRecipes = await AppDataSource.query(
        `
        SELECT
          r.id,
          r.name AS recipe_name,
          r.ingress,
          r.difficulty,
          r.servings,
          r."prepTime",
          r."cookTime",
          CASE WHEN r."userUid" = $2 THEN 'owned' ELSE 'liked' END AS recipe_type,
          1 - (r.embedding <=> $1::vector) AS similarity,
          (
            CASE WHEN r."userUid" = $2 THEN 0.10 ELSE 0 END
            + CASE WHEN EXISTS (
                SELECT 1 FROM "like" lk
                WHERE lk."userUid" = $2
                  AND lower(trim(lk."entityType")) = 'recipe'
                  AND trim(lk."entityId") = r.id::text
              ) THEN 0.15 ELSE 0 END
            + CASE WHEN $3 AND (
                r.name ILIKE '%cake%'
                OR r.ingress ILIKE '%cake%'
                OR r.ingress ILIKE '%sweet%'
                OR r.name ILIKE '%dessert%'
              ) THEN 0.05 ELSE 0 END
          ) AS boost,
          (
            1 - (r.embedding <=> $1::vector)
            + CASE WHEN r."userUid" = $2 THEN 0.10 ELSE 0 END
            + CASE WHEN EXISTS (
                SELECT 1 FROM "like" lk
                WHERE lk."userUid" = $2
                  AND lower(trim(lk."entityType")) = 'recipe'
                  AND trim(lk."entityId") = r.id::text
              ) THEN 0.15 ELSE 0 END
            + CASE WHEN $3 AND (
                r.name ILIKE '%cake%'
                OR r.ingress ILIKE '%cake%'
                OR r.ingress ILIKE '%sweet%'
                OR r.name ILIKE '%dessert%'
              ) THEN 0.05 ELSE 0 END
          ) AS score
        FROM recipe r
        WHERE r.embedding IS NOT NULL
          AND r.status = 'published'
          AND r."deletedAt" IS NULL
          AND (
            r."userUid" = $2
            OR EXISTS (
              SELECT 1 FROM "like" lk
              WHERE lk."userUid" = $2
                AND lower(trim(lk."entityType")) = 'recipe'
                AND trim(lk."entityId") = r.id::text
            )
          )
        ORDER BY score DESC
        LIMIT 8
        `,
        [vectorLiteral, userUid, hasDessertCue]
      );

      similarRecipes.forEach((r: any, idx: number) => {
        console.log(
          `${idx + 1}. ${r.name} (${r.recipe_type}) - Similarity: ${(
            r.similarity * 100
          )?.toFixed(1)}%`
        );
      });

      const userIngredients = await AppDataSource.query(
        `
        SELECT i.name, usi.is_priority
        FROM user_stored_ingredient usi
        INNER JOIN ingredient i ON usi."ingredientId" = i.id
        WHERE usi."userUid" = $1
        ORDER BY usi.is_priority DESC
        `,
        [userUid]
      );

      let context = "## Available Ingredients:\n";
      if (userIngredients.length > 0) {
        const priorityIngredients = userIngredients
          .filter((i: any) => i.is_priority)
          .map((i: any) => i.name);
        const otherIngredients = userIngredients
          .filter((i: any) => !i.is_priority)
          .map((i: any) => i.name);

        if (priorityIngredients.length > 0) {
          context += `Priority: ${priorityIngredients.join(", ")}\n`;
        }
        if (otherIngredients.length > 0) {
          context += `Others: ${otherIngredients.join(", ")}\n`;
        }
      } else {
        context += "None specified\n";
      }

      context +=
        "\n## Most Relevant Recipes (Retrieved via Semantic Search):\n";

      if (similarRecipes.length > 0) {
        similarRecipes.forEach((r: any, idx: number) => {
          const total = (r.prepTime || 0) + (r.cookTime || 0);
          const similarityPercent = (r.similarity * 100)?.toFixed(0);
          const typeLabel =
            r.recipe_type === "owned" ? "(Your Recipe)" : "(Liked)";
          context += `${idx + 1}. **${
            r.recipe_name
          }** ${typeLabel} (${similarityPercent}% match)\n`;
          context += `   ${r.ingress || "No description"}\n`;
          context += `   ${r.difficulty} difficulty | Serves ${
            r.servings || "N/A"
          } | ${total ? total + " min" : "Time N/A"}\n\n`;
        });
      } else {
        context +=
          "No recipes found in your collection. Please add or like some recipes first.\n";
      }

      const systemPrompt = `You are Sulten's cooking assistant. Answer based ONLY on the context provided below. The recipes shown are the most semantically relevant to the user's question based on vector similarity search.
  
  Be helpful, friendly, and specific. Reference the recipes by name and explain why they match the user's request.
  
  ${context}`;

      const reply = await ollama.chat([
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ]);

      return res.status(200).json({
        response: reply,
        debug: {
          question: message,
          embeddingGenerated: true,
          calculationMethod: "SQL pgvector similarity + boosts",

          relevantRecipesFound: similarRecipes.length,
          topRelevantRecipes: similarRecipes.map((r: any) => ({
            name: r.recipe_name,
            type: r.recipe_type,
            similarity: `${(r.similarity * 100)?.toFixed(1)}%`,
          })),
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

  private static cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
      throw new Error(
        `Vector dimension mismatch: ${vecA.length} vs ${vecB.length}`
      );
    }

    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      magnitudeA += vecA[i] * vecA[i];
      magnitudeB += vecB[i] * vecB[i];
    }

    magnitudeA = Math.sqrt(magnitudeA);
    magnitudeB = Math.sqrt(magnitudeB);

    if (magnitudeA === 0 || magnitudeB === 0) {
      return 0;
    }

    return dotProduct / (magnitudeA * magnitudeB);
  }

  static async generateEmbeddingsOllamaAll(req: Request, res: Response) {
    try {
      const ollama = new OllamaService();
      let processed = 0,
        errors = 0;
      const recipes = await AppDataSource.query(
        `SELECT id, name, ingress, difficulty, servings, "prepTime", "cookTime" FROM recipe WHERE embedding IS NULL`
      );
      for (const recipe of recipes) {
        const embedding = await ollama.embed(recipe.name);
        if (!embedding || embedding.length === 0) {
          errors++;
          continue;
        } else {
          processed++;
          const vectorLiteral = `[${embedding.join(",")}]`;
          await AppDataSource.query(
            `UPDATE recipe SET embedding = $1::vector WHERE id = $2`,
            [vectorLiteral, recipe.id]
          );
        }
      }
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
}
