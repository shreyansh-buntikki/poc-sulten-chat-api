import { tool } from "@openai/agents";
import { AppDataSource } from "../db";
import { OllamaService } from "../services/ollama.service";
import { MilvusService, SimpleIntent } from "../services/milvus.service";

interface RAGSearchArgs {
  query: string;
  excluded_ingredients?: string[];
  included_ingredients?: string[];
  max_time_minutes?: number;
  difficulty?: string;
  userUid?: string;
  limit?: number;
}

export const ragTool = tool({
  name: "rag_search",
  description:
    "Search recipes using semantic similarity (vector search). Finds recipes similar to the user's query. Can optionally filter by excluded ingredients, included ingredients, max time, or difficulty.",
  parameters: {
    type: "object" as const,
    properties: {
      query: {
        type: "string" as const,
        description:
          "The user's search query describing what they want (e.g., 'pasta dishes', 'quick breakfast', 'vegetarian dinner')",
      },
      excluded_ingredients: {
        type: "array" as const,
        items: { type: "string" as const },
        description:
          "Optional: List of ingredients to exclude. Recipes containing any of these will be excluded.",
      },
      included_ingredients: {
        type: "array" as const,
        items: { type: "string" as const },
        description:
          "Optional: List of ingredients that must be present in recipes.",
      },
      max_time_minutes: {
        type: "number" as const,
        description:
          "Optional: Maximum total time in minutes (prepTime + cookTime). Recipes exceeding this will be excluded.",
      },
      difficulty: {
        type: "string" as const,
        description:
          "Optional: Filter by difficulty level (e.g., 'easy', 'medium', 'hard').",
      },
      userUid: {
        type: "string" as const,
        description:
          "Optional: User ID to filter by user's recipes and liked recipes.",
      },
      limit: {
        type: "number" as const,
        description: "Maximum number of recipes to return (default: 10)",
      },
    },
    required: ["query"] as const,
    additionalProperties: true as const,
  },
  strict: false as const,
  execute: async (input: unknown) => {
    const args = input as RAGSearchArgs;

    try {
      const ollama = new OllamaService();
      const milvus = new MilvusService();

      const queryEmbedding = await ollama.embed(args.query);

      const intent: SimpleIntent = {
        excluded_ingredients: args.excluded_ingredients || [],
        required_ingredients: args.included_ingredients || [],
      };

      const milvusResults = await milvus.searchSimilarRecipes(
        queryEmbedding,
        args.limit || 20,
        intent
      );

      if (milvusResults.length === 0) {
        return {
          recipes: [],
          count: 0,
          message: "No recipes found matching your query",
        };
      }

      interface MilvusResult {
        recipe_id: string;
        similarity?: number;
        distance?: number;
      }

      const recipeIds = milvusResults.map((r: MilvusResult) => r.recipe_id);

      const conditions: string[] = [
        `r.id = ANY($1::uuid[])`,
        `r.status = 'published'`,
        `r."deletedAt" IS NULL`,
      ];

      const queryParams: (string | number | string[])[] = [recipeIds];
      let paramIndex = 2;

      if (args.max_time_minutes && args.max_time_minutes > 0) {
        conditions.push(
          `(COALESCE(r."prepTime", 0) + COALESCE(r."cookTime", 0)) <= $${paramIndex}`
        );
        queryParams.push(args.max_time_minutes);
        paramIndex++;
      }

      if (args.difficulty) {
        conditions.push(
          `LOWER(TRIM(r.difficulty)) = LOWER(TRIM($${paramIndex}))`
        );
        queryParams.push(args.difficulty);
        paramIndex++;
      }

      let userUidParamIndex = 0;
      if (args.userUid) {
        userUidParamIndex = paramIndex;
        queryParams.push(args.userUid);
        paramIndex++;
      }

      queryParams.push(args.limit || 10);

      const whereClause = conditions.join(" AND ");

      const recipes = await AppDataSource.query(
        `
        SELECT r.id, r.name AS recipe_name, r.slug, r.ingress, r.difficulty, 
               r.servings, r."prepTime", r."cookTime", r."userUid",
               (COALESCE(r."prepTime", 0) + COALESCE(r."cookTime", 0)) AS total_time,
               (
                 SELECT COALESCE(
                   json_agg(json_build_object('order', rin."order", 'description', rin.description) ORDER BY rin."order"),
                   '[]'::json
                 )
                 FROM recipe_instruction rin
                 WHERE rin."recipeId" = r.id
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
               ) AS ingredients,
               ${
                 args.userUid
                   ? `EXISTS (
                 SELECT 1 FROM "like" lk
                 WHERE lk."userUid" = $${userUidParamIndex}
                   AND lower(trim(lk."entityType")) = 'recipe'
                   AND trim(lk."entityId") = r.id::text
               ) AS is_liked`
                   : `false AS is_liked`
               }
        FROM recipe r
        WHERE ${whereClause}
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
        userUid: string;
        total_time: number;
        instructions: Array<{ order: number; description: string }>;
        ingredients: Array<{
          name: string;
          amount: number;
          unit: string;
          order: number;
        }>;
        is_liked: boolean;
      }

      interface RecipeWithSimilarity {
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
        recipe_type: string;
        similarity: number;
        distance: number;
      }

      const recipeMap = new Map<string, RecipeRow>(
        recipes.map((r: RecipeRow) => [r.id, r])
      );
      const milvusMap = new Map<string, MilvusResult>(
        milvusResults.map((r: MilvusResult) => [r.recipe_id, r])
      );

      const recipesWithSimilarity: RecipeWithSimilarity[] = recipeIds
        .map((id: string): RecipeWithSimilarity | null => {
          const recipe = recipeMap.get(id);
          const milvusResult = milvusMap.get(id);
          if (!recipe) return null;

          let recipe_type = "global";
          if (args.userUid && recipe.userUid === args.userUid) {
            recipe_type = "owned";
          } else if (args.userUid && recipe.is_liked) {
            recipe_type = "liked";
          }

          return {
            id: recipe.id,
            recipe_name: recipe.recipe_name,
            slug: recipe.slug,
            ingress: recipe.ingress,
            difficulty: recipe.difficulty,
            servings: recipe.servings,
            prepTime: recipe.prepTime,
            cookTime: recipe.cookTime,
            total_time: recipe.total_time,
            instructions: recipe.instructions || [],
            ingredients: recipe.ingredients || [],
            recipe_type,
            similarity: milvusResult?.similarity || 0,
            distance: milvusResult?.distance || 0,
          };
        })
        .filter(
          (r: RecipeWithSimilarity | null): r is RecipeWithSimilarity =>
            r !== null
        )
        .slice(0, args.limit || 10);

      return {
        recipes: recipesWithSimilarity,
        count: recipesWithSimilarity.length,
        message: `Found ${recipesWithSimilarity.length} recipe(s) matching your query`,
      };
    } catch (error) {
      console.error("Error executing ragTool:", error);
      return {
        recipes: [],
        count: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
