import { tool } from "@openai/agents";
import { AppDataSource } from "../db";
import { OllamaService } from "../services/ollama.service";
import { MilvusService, SimpleIntent } from "../services/milvus.service";

interface HybridSearchArgs {
  query: string;
  excluded_ingredients?: string[];
  max_time_minutes?: number;
  difficulty?: string;
  cuisine?: string;
  limit?: number;
}

/**
 * Hybrid search tool that combines SQL deterministic filtering with RAG semantic search
 *
 * Use when user has both:
 * - Hard constraints (allergies, time limits, difficulty) - MUST be satisfied
 * - Mood-based preferences (semantic queries like "cozy", "comforting") - ranked by relevance
 *
 * How it works:
 * 1. Applies hard constraints (excluded_ingredients) via Milvus filter - guarantees safety
 * 2. Ranks remaining recipes by semantic similarity to query - maximizes relevance
 * 3. Applies additional SQL filters (time, difficulty, cuisine) on filtered results
 * 4. Returns recipes that satisfy both semantic and deterministic constraints
 */
export const hybridTool = tool({
  name: "hybrid_search",
  description:
    'Hybrid search combining semantic similarity with hard constraints. Use when user has both mood-based preferences (e.g., "cozy dinner", "comforting meal") AND hard constraints (e.g., allergies like "no chicken", time limits, difficulty). Guarantees safety (hard constraints) while maximizing relevance (semantic match). Example: "I want something cozy for dinner, but I\'m allergic to chicken" - returns chicken-free recipes ranked by how "cozy" they are.',
  parameters: {
    type: "object" as const,
    properties: {
      query: {
        type: "string" as const,
        description:
          "The semantic/mood-based search query (e.g., 'cozy dinner', 'comforting meal', 'quick and easy breakfast'). This is used for semantic similarity ranking.",
      },
      excluded_ingredients: {
        type: "array" as const,
        items: { type: "string" as const },
        description:
          "Hard constraint: List of ingredients to exclude (e.g., ['chicken', 'nuts']). Recipes containing ANY of these will be excluded.",
      },
      max_time_minutes: {
        type: "number" as const,
        description:
          "Hard constraint: Maximum total time in minutes (prepTime + cookTime). Recipes exceeding this will be excluded.",
      },
      difficulty: {
        type: "string" as const,
        description:
          "Hard constraint: Filter by exact difficulty level (e.g., 'easy', 'medium', 'hard').",
      },
      cuisine: {
        type: "string" as const,
        description:
          "Hard constraint: Filter by cuisine type (e.g., 'italian', 'mexican', 'asian'). Case-insensitive.",
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
    const args = input as HybridSearchArgs;

    try {
      const {
        query,
        excluded_ingredients = [],
        max_time_minutes,
        difficulty,
        cuisine,
        limit = 10,
      } = args;

      const ollama = new OllamaService();
      const milvus = new MilvusService();

      // Step 1: Generate embedding for semantic query
      const queryEmbedding = await ollama.embed(query);

      // Step 2: Build intent with excluded ingredients for Milvus filter
      // This guarantees recipes with excluded ingredients are filtered out at the vector search level
      const intent: SimpleIntent = {
        excluded_ingredients: excluded_ingredients || [],
        required_ingredients: [], // Hybrid search doesn't use required ingredients
      };

      // Step 3: Search Milvus with ingredient filter + semantic similarity
      // This ensures:
      // - No excluded ingredients (safety guarantee)
      // - Results ranked by semantic similarity to query (relevance)
      const milvusLimit = Math.max(limit * 2, 50); // Get more results for SQL filtering
      const milvusResults = await milvus.searchSimilarRecipes(
        queryEmbedding,
        milvusLimit,
        intent
      );

      if (milvusResults.length === 0) {
        return {
          recipes: [],
          count: 0,
          message: "No recipes found matching your query and constraints",
        };
      }

      interface MilvusResult {
        recipe_id: string;
        similarity?: number;
        distance?: number;
      }

      // Step 4: Get recipe IDs from Milvus results (already filtered by excluded ingredients)
      const recipeIds = milvusResults.map((r: MilvusResult) => r.recipe_id);

      // Step 5: Apply additional SQL filters on Milvus results
      const conditions: string[] = [
        `r.id = ANY($1::uuid[])`,
        `r.status = 'published'`,
        `r."deletedAt" IS NULL`,
      ];

      const queryParams: (string | number | string[])[] = [recipeIds];
      let paramIndex = 2;

      // Filter by max time
      if (max_time_minutes && max_time_minutes > 0) {
        conditions.push(
          `(COALESCE(r."prepTime", 0) + COALESCE(r."cookTime", 0)) <= $${paramIndex}`
        );
        queryParams.push(max_time_minutes);
        paramIndex++;
      }

      // Filter by difficulty
      if (difficulty) {
        conditions.push(
          `LOWER(TRIM(r.difficulty)) = LOWER(TRIM($${paramIndex}))`
        );
        queryParams.push(difficulty);
        paramIndex++;
      }

      // Filter by cuisine
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

      // Step 6: Query Postgres with full recipe details
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
        similarity: number;
        distance: number;
      }

      // Step 7: Map Milvus similarity scores to recipes and maintain ranking
      const recipeMap = new Map<string, RecipeRow>(
        recipes.map((r: RecipeRow) => [r.id, r])
      );
      const milvusMap = new Map<string, MilvusResult>(
        milvusResults.map((r: MilvusResult) => [r.recipe_id, r])
      );

      // Maintain Milvus ranking order (semantic similarity)
      const recipesWithSimilarity: RecipeWithSimilarity[] = recipeIds
        .map((id: string): RecipeWithSimilarity | null => {
          const recipe = recipeMap.get(id);
          const milvusResult = milvusMap.get(id);
          if (!recipe) return null;

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
            similarity: milvusResult?.similarity || 0,
            distance: milvusResult?.distance || 0,
          };
        })
        .filter(
          (r: RecipeWithSimilarity | null): r is RecipeWithSimilarity =>
            r !== null
        )
        .slice(0, limit);

      return {
        recipes: recipesWithSimilarity,
        count: recipesWithSimilarity.length,
        message: `Found ${recipesWithSimilarity.length} recipe(s) matching your mood ("${query}") and constraints`,
        filters_applied: {
          semantic_query: query,
          excluded_ingredients:
            excluded_ingredients.length > 0 ? excluded_ingredients : undefined,
          max_time_minutes: max_time_minutes || undefined,
          difficulty: difficulty || undefined,
          cuisine: cuisine || undefined,
        },
      };
    } catch (error) {
      console.error("Error executing hybridTool:", error);
      return {
        recipes: [],
        count: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
