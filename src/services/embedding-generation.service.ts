import { AppDataSource } from "../db";
import { EmbeddingsService } from "./embeddings.service";
import { OllamaService } from "./ollama.service";
import { Recipe } from "../entities/entities/Recipe";
import { Like as LikeRepo } from "../entities/entities/Like";

export class EmbeddingGenerationService {
  /**
   * Generate embeddings for user's recipes using EmbeddingsService
   */
  static async generateEmbeddingsForUser(username: string) {
    const embeddingsService = new EmbeddingsService();

    // First find the user
    const user = await AppDataSource.query(
      `SELECT uid FROM "user" WHERE username = $1`,
      [username]
    );

    if (!user || user.length === 0) {
      throw new Error("User not found");
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
        const embedding = await embeddingsService.generateEmbedding(recipeText);

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

    return {
      message: "Embeddings generation completed",
      processed,
      errors,
      total: recipesToProcess.length,
    };
  }

  /**
   * Generate embeddings for user's recipes using Ollama
   */
  static async generateEmbeddingsOllamaForUser(username: string) {
    const ollama = new OllamaService();

    const user = await AppDataSource.query(
      `SELECT uid FROM "user" WHERE username = $1`,
      [username]
    );
    if (!user || user.length === 0) {
      throw new Error("User not found");
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
                    ing.measuring_unit_name ? ing.measuring_unit_name + " " : ""
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

    return {
      message: "Ollama embeddings completed",
      processed,
      errors,
      total: recipes.length,
    };
  }

  /**
   * Generate embeddings for all recipes using Ollama
   */
  static async generateEmbeddingsOllamaAll() {
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
    return {
      message: "Embeddings generation completed",
      processed,
      errors,
      total: recipes.length,
    };
  }
}
