import { tool } from "@openai/agents";
import { AppDataSource } from "../db";

interface SqlSearchArgs {
  excluded_ingredients?: string[];
  max_time_minutes?: number;
  difficulty?: string;
  cuisine?: string;
  limit?: number;
}

export const sqlTool = tool({
  name: "sql_search",
  description:
    'Search recipes using exact SQL filters for hard constraints. Use when user has strict requirements like allergies ("no chicken"), time limits ("under 30 mins"), difficulty ("easy only"), or cuisine ("Italian"). This tool guarantees exact compliance - it never guesses or approximates.',
  parameters: {
    type: "object" as const,
    properties: {
      excluded_ingredients: {
        type: "array" as const,
        items: { type: "string" as const },
        description:
          "List of ingredients to exclude (e.g., ['chicken', 'nuts']). Recipes containing ANY of these will be excluded.",
      },
      max_time_minutes: {
        type: "number" as const,
        description:
          "Maximum total time in minutes (prepTime + cookTime). Recipes exceeding this will be excluded.",
      },
      difficulty: {
        type: "string" as const,
        description:
          "Filter by exact difficulty level (e.g., 'easy', 'medium', 'hard').",
      },
      cuisine: {
        type: "string" as const,
        description:
          "Filter by cuisine type (e.g., 'italian', 'mexican', 'asian'). Case-insensitive.",
      },
      limit: {
        type: "number" as const,
        description: "Maximum number of recipes to return (default: 10)",
      },
    },
    required: [] as const,
    additionalProperties: true as const,
  },
  strict: false as const,
  execute: async (input: unknown) => {
    const args = input as SqlSearchArgs;

    try {
      const {
        excluded_ingredients = [],
        max_time_minutes,
        difficulty,
        cuisine,
        limit = 10,
      } = args;

      const conditions: string[] = [
        `r.status = 'published'`,
        `r."deletedAt" IS NULL`,
      ];

      const queryParams: (string | number | string[])[] = [];
      let paramIndex = 1;

      if (excluded_ingredients && excluded_ingredients.length > 0) {
        const normalizedExcluded = excluded_ingredients.map((ing) =>
          ing.toLowerCase().trim()
        );
        conditions.push(`
          NOT EXISTS (
            SELECT 1
            FROM recipe_ingredient ri
            INNER JOIN ingredient i ON ri."ingredientId" = i.id
            WHERE ri."recipeId" = r.id
              AND ri."deletedAt" IS NULL
              AND LOWER(TRIM(i.name)) = ANY($${paramIndex}::text[])
          )
        `);
        queryParams.push(normalizedExcluded);
        paramIndex++;
      }

      if (max_time_minutes && max_time_minutes > 0) {
        conditions.push(
          `(COALESCE(r."prepTime", 0) + COALESCE(r."cookTime", 0)) <= $${paramIndex}`
        );
        queryParams.push(max_time_minutes);
        paramIndex++;
      }

      if (difficulty) {
        conditions.push(
          `LOWER(TRIM(r.difficulty)) = LOWER(TRIM($${paramIndex}))`
        );
        queryParams.push(difficulty);
        paramIndex++;
      }

      if (cuisine) {
        conditions.push(`
          EXISTS (
            SELECT 1
            FROM recipe_tags_tag rtt
            INNER JOIN tag t ON rtt."tagId" = t.id
            WHERE rtt."recipeId" = r.id
              AND LOWER(TRIM(t.name)) = LOWER(TRIM($${paramIndex}))
          )
        `);
        queryParams.push(cuisine);
        paramIndex++;
      }

      queryParams.push(limit);

      const whereClause = conditions.join(" AND ");

      const recipes = await AppDataSource.query(
        `
        SELECT r.id, r.name AS recipe_name, r.slug, r.ingress, r.difficulty, 
               r.servings, r."prepTime", r."cookTime",
               (COALESCE(r."prepTime", 0) + COALESCE(r."cookTime", 0)) AS total_time,
               (
                 SELECT COALESCE(
                   json_agg(json_build_object('order', rin."order", 'description', rin.description) ORDER BY rin."order"),
                   '[]'::json
                 )
                 FROM recipe_instruction rin
                 WHERE rin."recipeId" = r.id
                   AND rin."deletedAt" IS NULL
               ) AS instructions,
               (
                 SELECT COALESCE(
                   json_agg(
                     json_build_object(
                       'name', i.name,
                       'amount', ri.amount,
                       'unit', (
                         SELECT mut2.name 
                         FROM measuring_unit_translation mut2 
                         WHERE mut2."measuringUnitId" = mu.id 
                         LIMIT 1
                       ),
                       'order', ri."order"
                     ) ORDER BY ri."order"
                   ),
                   '[]'::json
                 )
                 FROM recipe_ingredient ri
                 INNER JOIN ingredient i ON ri."ingredientId" = i.id
                 LEFT JOIN measuring_unit mu ON ri."unitId" = mu.id
                 WHERE ri."recipeId" = r.id
                   AND ri."deletedAt" IS NULL
               ) AS ingredients
        FROM recipe r
        WHERE ${whereClause}
        ORDER BY total_time ASC, r.name ASC
        LIMIT $${paramIndex}
        `,
        queryParams
      );

      interface RecipeRow {
        id: string;
        recipe_name: string;
        slug: string;
        ingress: string;
        difficulty: string;
        servings: number;
        prepTime: number;
        cookTime: number;
        total_time: number;
        instructions: Array<{ order: number; description: string }>;
        ingredients: Array<{
          name: string;
          amount: number;
          unit: string;
          order: number;
        }>;
      }

      const formattedRecipes = recipes.map((r: RecipeRow) => ({
        id: r.id,
        recipe_name: r.recipe_name,
        slug: r.slug,
        ingress: r.ingress,
        difficulty: r.difficulty,
        servings: r.servings,
        prepTime: r.prepTime,
        cookTime: r.cookTime,
        total_time: r.total_time,
        instructions: r.instructions || [],
        ingredients: r.ingredients || [],
      }));

      return {
        recipes: formattedRecipes,
        count: formattedRecipes.length,
        message: `Found ${formattedRecipes.length} recipe(s) matching all specified constraints`,
        filters_applied: {
          excluded_ingredients:
            excluded_ingredients.length > 0 ? excluded_ingredients : undefined,
          max_time_minutes: max_time_minutes || undefined,
          difficulty: difficulty || undefined,
          cuisine: cuisine || undefined,
        },
      };
    } catch (error) {
      console.error("Error executing sqlTool:", error);
      return {
        recipes: [],
        count: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
