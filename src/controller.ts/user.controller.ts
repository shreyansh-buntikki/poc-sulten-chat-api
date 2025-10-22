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

const ApiKey = process.env.AI_KEY;

export class UserController {
  private static chatHistory: Map<
    string,
    Array<{ role: "system" | "user" | "assistant"; content: string }>
  > = new Map();
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
      let timeToQuery = 0;
      let timeToGenerateEmbedding = 0;
      let timeToGenerateAIResponse = 0;
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
      
      User message: "${message}"
      
      Answer (YES or NO):`;

      const topicCheck = await ollama.chat([
        {
          role: "user",
          content: topicCheckPrompt,
        },
      ]);

      const topicCheckEndTime = Date.now();
      timeToCheckTopic = topicCheckEndTime - topicCheckStartTime;

      const isOnTopic = topicCheck.trim().toUpperCase().includes("YES");

      if (!isOnTopic) {
        return res.status(200).json({
          response:
            "Hi, I'm Sulten's cooking assistant and can only help with food and recipe-related questions. Please ask me about recipes, ingredients, cooking techniques, or meal planning!",
          debug: {
            question: message,
            reason: "Question is off-topic",
            topicCheck,
            isOnTopic,
          },
        });
      }
      const questionEmbeddingStartTime = Date.now();
      const questionEmbedding = await ollama.embed(message);
      const questionEmbeddingEndTime = Date.now();
      timeToGenerateEmbedding =
        questionEmbeddingEndTime - questionEmbeddingStartTime;
      if (!questionEmbedding || questionEmbedding.length === 0) {
        throw new Error("Failed to generate question embedding");
      }
      const vectorLiteral = `[${questionEmbedding.join(",")}]`;
      const queryStartTime = Date.now();
      const likedTop2 = await AppDataSource.query(
        `
        SELECT r.id, r.name AS recipe_name, r.ingress, r.difficulty, r.servings, r."prepTime", r."cookTime",
               1 - (r.embedding <=> $1::vector) AS similarity,
               (
                 SELECT COALESCE(
                   json_agg(json_build_object('order', rin."order", 'description', rin.description) ORDER BY rin."order"),
                   '[]'::json
                 )
                 FROM recipe_instruction rin
                 WHERE rin."recipeId" = r.id
               ) AS instructions,
               'liked'::text AS recipe_type
        FROM recipe r
        WHERE r.embedding IS NOT NULL
          AND r.status = 'published'
          AND r."deletedAt" IS NULL
          AND EXISTS (
            SELECT 1 FROM "like" lk
            WHERE lk."userUid" = $2
              AND lower(trim(lk."entityType")) = 'recipe'
              AND trim(lk."entityId") = r.id::text
          )
        ORDER BY r.embedding <=> $1::vector
        LIMIT 2
        `,
        [vectorLiteral, userUid]
      );

      const ownedTop3 = await AppDataSource.query(
        `
        SELECT r.id, r.name AS recipe_name, r.ingress, r.difficulty, r.servings, r."prepTime", r."cookTime",
               1 - (r.embedding <=> $1::vector) AS similarity,
               (
                 SELECT COALESCE(
                   json_agg(json_build_object('order', rin."order", 'description', rin.description) ORDER BY rin."order"),
                   '[]'::json
                 )
                 FROM recipe_instruction rin
                 WHERE rin."recipeId" = r.id
               ) AS instructions,
               'owned'::text AS recipe_type
        FROM recipe r
        WHERE r.embedding IS NOT NULL
          AND r.status = 'published'
          AND r."deletedAt" IS NULL
          AND r."userUid" = $2
        ORDER BY r.embedding <=> $1::vector
        LIMIT 3
        `,
        [vectorLiteral, userUid]
      );

      const excludeIds: string[] = [
        ...new Set<string>([...likedTop2, ...ownedTop3].map((r: any) => r.id)),
      ];
      const excludeArray = `{${excludeIds.join(",")}}`;
      const globalTop5 = await AppDataSource.query(
        `
        SELECT r.id, r.name AS recipe_name, r.ingress, r.difficulty, r.servings, r."prepTime", r."cookTime",
               1 - (r.embedding <=> $1::vector) AS similarity,
               (
                 SELECT COALESCE(
                   json_agg(json_build_object('order', rin."order", 'description', rin.description) ORDER BY rin."order"),
                   '[]'::json
                 )
                 FROM recipe_instruction rin
                 WHERE rin."recipeId" = r.id
               ) AS instructions,
               'global'::text AS recipe_type
        FROM recipe r
        WHERE r.embedding IS NOT NULL
          AND r.status = 'published'
          AND r."deletedAt" IS NULL
          AND (array_length($2::uuid[],1) IS NULL OR r.id <> ALL($2::uuid[]))
        ORDER BY r.embedding <=> $1::vector
        LIMIT 5
        `,
        [vectorLiteral, excludeArray]
      );

      console.log({
        likedTop2,
        ownedTop3,
        globalTop5,
      });

      const similarRecipes = [
        ...likedTop2,
        ...ownedTop3.filter((r: any) => !excludeIds.includes(r.id)),
        ...globalTop5,
      ];

      similarRecipes.forEach((r: any, idx: number) => {
        console.log(
          `${idx + 1}. ${r.name} (${r.recipe_type}) - Similarity: ${(
            r.similarity * 100
          )?.toFixed(1)}%`
        );
      });

      // Instructions included per recipe row as JSON array in field `instructions`

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
      const queryEndTime = Date.now();
      timeToQuery = queryEndTime - queryStartTime;
      let context = "";
      // let context = "## Available Ingredients:\n";
      // if (userIngredients.length > 0) {
      //   const priorityIngredients = userIngredients
      //     .filter((i: any) => i.is_priority)
      //     .map((i: any) => i.name);
      //   const otherIngredients = userIngredients
      //     .filter((i: any) => !i.is_priority)
      //     .map((i: any) => i.name);

      //   if (priorityIngredients.length > 0) {
      //     context += `Priority: ${priorityIngredients.join(", ")}\n`;
      //   }
      //   if (otherIngredients.length > 0) {
      //     context += `Others: ${otherIngredients.join(", ")}\n`;
      //   }
      // } else {
      //   context += "None specified\n";
      // }

      context +=
        "\n## Most Relevant Recipes (Retrieved via Semantic Search):\n";

      if (similarRecipes.length > 0) {
        similarRecipes.forEach((r: any, idx: number) => {
          const total = (r.prepTime || 0) + (r.cookTime || 0);
          const similarityPercent = (r.similarity * 100)?.toFixed(0);
          const typeLabel =
            r.recipe_type === "owned"
              ? "(Your Recipe)"
              : r.recipe_type === "liked"
              ? "(Liked)"
              : "";
          context += `${idx + 1}. **${
            r.recipe_name
          }** ${typeLabel} (${similarityPercent}% match)\n`;
          context += `   ${r.ingress || "No description"}\n`;
          context += `   ${r.difficulty} difficulty | Serves ${
            r.servings || "N/A"
          } | ${total ? total + " min" : "Time N/A"}\n`;

          const steps = Array.isArray(r.instructions) ? r.instructions : [];
          if (steps.length > 0) {
            context += `   Instructions:\n`;
            steps.forEach((s: any, si: number) => {
              if (s?.description) {
                context += `     ${si + 1}. ${s.description}\n`;
              }
            });
          }
          context += `\n`;
        });
      } else {
        context +=
          "No recipes found in your collection. Please add or like some recipes first.\n";
      }
      const systemPromptStartTime = Date.now();

      const systemPrompt =
        similarRecipes.length > 0
          ? `You are Sulten's cooking assistant.

🚨 CRITICAL INSTRUCTION 🚨
You MUST ONLY recommend recipes from the "Most Relevant Recipes" list below.
You are NOT allowed to create, invent, or suggest any recipe that does not appear in this list.
You MUST use the exact recipe names shown below.

FORMATTING REQUIREMENTS:
- Use Markdown formatting for all responses.
- Recipe names should be bold: **Recipe Name**
- Use bullet points (-) for lists
- Use numbered lists (1. 2. 3.) for instructions
- Use > for important notes or tips
- Example format:

**Spicy Coconut Thai Curry Soup** (75% match)

This soup is perfect because:
- Contains coconut milk
- Authentic Thai flavors
- Quick 20-minute cook time

Would you like the full recipe instructions?

INSTRUCTIONS RULES:
- Never invent or add steps that are not in the provided context.
- If instructions for a recipe are present, you must use ONLY those steps.
- You may paraphrase wording slightly for clarity, but preserve the original step order and meaning exactly.
- Only provide full instructions if the user explicitly asks for them or confirms interest.
- If instructions are not available for a recipe, say so rather than making them up.

${context}

REMINDER: You can ONLY recommend recipes from the "Most Relevant Recipes" list above. Do not create new recipes.`
          : `You are Sulten's cooking assistant.

I could not find any matching recipes in the database for this request.

FORMATTING REQUIREMENTS:
- Use Markdown formatting for all responses
- Recipe name should be bold: **Recipe Name**
- Use numbered lists for instructions
- Use bullet points for ingredients
- Example format:

**Thai Coconut Curry with Your Ingredients**

### Ingredients:
- Coconut milk
- Garlic chives
- Yellow onion
- Carrot

### Instructions:
1. Heat oil in a pan
2. Add onions and cook until soft
3. ...

> 💡 **Tip:** This is a custom suggestion since no exact matches were found in your collection.

Would you like me to save this recipe to your collection?

Since no recipes were found, create a helpful recipe suggestion based on:
User's request: ${message}`;

      const { content, memory } = await lc.generateReply(
        userUid,
        systemPrompt,
        message
      );
      const systemPromptEndTime = Date.now();
      timeToGenerateAIResponse = systemPromptEndTime - systemPromptStartTime;

      const previousMessages = await lc.getPreviousMessages(userUid);

      return res.status(200).json({
        response: content,
        previousMessages,
        debug: {
          memory,
          question: message,
          embeddingGenerated: true,
          userIngredients,
          calculationMethod: "SQL pgvector similarity + boosts",
          likedTop2,
          ownedTop3,
          globalTop5,
          systemPrompt,
          time: {
            timeToCheckTopic,
            timeToGenerateEmbedding,
            timeToQuery,
            timeToGenerateAIResponse,
          },
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
        `SELECT id, name, ingress, difficulty, servings, "prepTime", "cookTime" FROM recipe`
      );
      for (const recipe of recipes) {
        try {
          // Gather ingredients (names only) for signal
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
          // skip and continue processing remaining recipes
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
}
