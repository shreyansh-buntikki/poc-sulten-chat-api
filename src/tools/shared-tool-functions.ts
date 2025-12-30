import { AppDataSource } from "../db";
import { OllamaService } from "../services/ollama.service";
import { MilvusService, SimpleIntent } from "../services/milvus.service";

/**
 * Helper function to check if any ingredient matches excluded terms using partial matching
 * Returns true if recipe should be EXCLUDED (has matching ingredient)
 */
function hasExcludedIngredient(
  ingredients: Array<{ name: string }>,
  excludedTerms: string[]
): boolean {
  if (!excludedTerms || excludedTerms.length === 0) return false;
  if (!ingredients || ingredients.length === 0) return false;

  const normalizedExcluded = excludedTerms.map((t) => t.toLowerCase().trim());

  for (const ingredient of ingredients) {
    const ingredientName = ingredient.name?.toLowerCase() || "";
    for (const excluded of normalizedExcluded) {
      // Check if ingredient name contains the excluded term
      if (ingredientName.includes(excluded)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Build SQL condition for excluding ingredients using ILIKE (partial match)
 */
function buildExcludedIngredientsCondition(
  excludedIngredients: string[],
  startParamIndex: number
): { condition: string; params: string[]; nextParamIndex: number } {
  if (!excludedIngredients || excludedIngredients.length === 0) {
    return { condition: "", params: [], nextParamIndex: startParamIndex };
  }

  const conditions: string[] = [];
  const params: string[] = [];

  for (let i = 0; i < excludedIngredients.length; i++) {
    const paramIdx = startParamIndex + i;
    conditions.push(`LOWER(i.name) ILIKE $${paramIdx}`);
    params.push(`%${excludedIngredients[i].toLowerCase().trim()}%`);
  }

  const condition = `
    NOT EXISTS (
      SELECT 1
      FROM recipe_ingredient ri
      INNER JOIN ingredient i ON ri."ingredientId" = i.id
      WHERE ri."recipeId" = r.id
        AND ri."deletedAt" IS NULL
        AND (${conditions.join(" OR ")})
    )
  `;

  return {
    condition,
    params,
    nextParamIndex: startParamIndex + excludedIngredients.length,
  };
}

export interface RAGSearchArgs {
  query: string;
  excluded_ingredients?: string[];
  included_ingredients?: string[];
  max_time_minutes?: number;
  difficulty?: string;
  userUid?: string;
  limit?: number;
}

export interface SqlSearchArgs {
  excluded_ingredients?: string[];
  included_ingredients?: string[];
  max_time_minutes?: number;
  difficulty?: string;
  cuisine?: string;
  limit?: number;
  price_constraints?: { min: number; max: number };
  macronutrients?: Record<string, "high" | "low">;
  seasonality?: string[];
}

export interface HybridSearchArgs {
  query: string;
  excluded_ingredients?: string[];
  included_ingredients?: string[];
  max_time_minutes?: number;
  difficulty?: string;
  cuisine?: string;
  limit?: number;
  price_constraints?: { min: number; max: number };
  macronutrients?: Record<string, "high" | "low">;
  seasonality?: string[];
}

interface MilvusResult {
  recipe_id: string;
  similarity?: number;
  distance?: number;
}

interface RecipeRow {
  id: string;
  recipe_name: string;
  slug: string;
  ingress: string;
  difficulty: string;
  servings: number;
  prepTime: number;
  cookTime: number;
  userUid?: string;
  total_time: number;
  meta?: string | null;
  instructions: Array<{ order: number; description: string }>;
  ingredients: Array<{
    name: string;
    amount: number;
    unit: string;
    order: number;
  }>;
  is_liked?: boolean;
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
  recipe_type?: string;
  similarity: number;
  distance: number;
}

export interface ToolResult {
  recipes: any[];
  count: number;
  message?: string;
  error?: string;
  filters_applied?: Record<string, any>;
}

export const toolDefinitions = {
  rag_search: {
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
      required: ["query"],
    },
  },
  sql_search: {
    name: "sql_search",
    description:
      'Search recipes using exact SQL filters for hard constraints. Use when user has strict requirements like allergies ("no chicken"), time limits ("under 30 mins"), difficulty ("easy only"), cuisine ("Italian"), macronutrients ("high protein", "low calories"), price constraints, or seasonality ("spring", "summer", "winter"). This tool guarantees exact compliance - it never guesses or approximates. Recipes are sorted by macronutrient match score when macronutrients are specified.',
    parameters: {
      type: "object" as const,
      properties: {
        excluded_ingredients: {
          type: "array" as const,
          items: { type: "string" as const },
          description:
            "List of ingredients to exclude (e.g., ['chicken', 'nuts']). Recipes containing ANY of these will be excluded.",
        },
        included_ingredients: {
          type: "array" as const,
          items: { type: "string" as const },
          description:
            "List of ingredients that must be present in recipes (e.g., ['pork', 'beef']). Recipes must contain at least one of these.",
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
        price_constraints: {
          type: "object" as const,
          properties: {
            min: { type: "number" as const },
            max: { type: "number" as const },
          },
          description:
            "Price range filter. min and max should be in the same currency (e.g., {min: 100, max: 500} for INR/NOK/USD). Filters recipes based on their estimated price from the meta column.",
        },
        macronutrients: {
          type: "object" as const,
          additionalProperties: {
            type: "string" as const,
            enum: ["high", "low"],
          },
          description:
            "Filter by macronutrient levels. Keys are nutrient names (e.g., 'protein', 'carbohydrates', 'fat', 'calories'). Values are 'high' or 'low'. Recipes are sorted by relevance to these constraints using their meta column data. Example: {protein: 'high', calories: 'low'}.",
        },
        seasonality: {
          type: "array" as const,
          items: { type: "string" as const },
          description:
            "Filter by seasonality, festivals, or occasions. Array of lowercase snake_case strings. Can include seasons (e.g., 'spring', 'summer', 'autumn', 'fall', 'winter') or festivals/occasions (e.g., 'christmas', 'thanksgiving', 'easter', 'diwali', 'holi', 'new_year', 'independence_day'). Recipes must have at least one matching seasonality in their meta column. Example: ['spring', 'summer'] or ['christmas', 'winter'].",
        },
        limit: {
          type: "number" as const,
          description: "Maximum number of recipes to return (default: 10)",
        },
      },
      required: [],
    },
  },
  hybrid_search: {
    name: "hybrid_search",
    description:
      'Hybrid search combining semantic similarity with hard constraints. Use when user has both mood-based preferences (e.g., "cozy dinner", "comforting meal") AND hard constraints (e.g., allergies like "no chicken", time limits, difficulty, macronutrients, price, seasonality). Guarantees safety (hard constraints) while maximizing relevance (semantic match). Example: "I want something cozy for dinner, but I\'m allergic to chicken" - returns chicken-free recipes ranked by how "cozy" they are.',
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
        included_ingredients: {
          type: "array" as const,
          items: { type: "string" as const },
          description:
            "Hard constraint: List of ingredients that must be present in recipes (e.g., ['pork', 'beef']). Recipes must contain at least one of these.",
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
        price_constraints: {
          type: "object" as const,
          properties: {
            min: { type: "number" as const },
            max: { type: "number" as const },
          },
          description:
            "Hard constraint: Price range filter. min and max should be in the same currency (e.g., {min: 100, max: 500} for INR/NOK/USD). Filters recipes based on their estimated price.",
        },
        macronutrients: {
          type: "object" as const,
          additionalProperties: {
            type: "string" as const,
            enum: ["high", "low"],
          },
          description:
            "Hard constraint: Filter by macronutrient levels. Keys are nutrient names (e.g., 'protein', 'carbohydrates', 'fat', 'calories'). Values are 'high' or 'low'. Recipes are sorted by relevance to these constraints using their meta column data.",
        },
        seasonality: {
          type: "array" as const,
          items: { type: "string" as const },
          description:
            "Hard constraint: Filter by seasonality, festivals, or occasions. Array of lowercase snake_case strings. Can include seasons (e.g., 'spring', 'summer', 'autumn', 'fall', 'winter') or festivals/occasions (e.g., 'christmas', 'thanksgiving', 'easter', 'diwali', 'holi', 'new_year', 'independence_day'). Recipes must have at least one matching seasonality in their meta column. Example: ['spring', 'summer'] or ['christmas', 'winter'].",
        },
        limit: {
          type: "number" as const,
          description: "Maximum number of recipes to return (default: 10)",
        },
      },
      required: ["query"],
    },
  },
};

// ============================================================================
// Core Tool Functions
// ============================================================================

/**
 * RAG Search - Uses vector similarity search with optional SQL filters
 */
export async function executeRAGSearch(
  args: RAGSearchArgs
): Promise<ToolResult> {
  console.log(
    "[RAGSearch] Tool called - Arguments:",
    JSON.stringify(args, null, 2)
  );
  try {
    const ollama = new OllamaService();
    const milvus = new MilvusService();

    const queryEmbedding = await ollama.embed(args.query);

    // Don't filter excluded_ingredients at Milvus level - it's too restrictive
    // We handle excluded_ingredients filtering in post-processing instead
    const milvusResults = await milvus.searchSimilarRecipes(
      queryEmbedding,
      Math.max((args.limit || 10) * 3, 50),
      {
        excluded_ingredients: args.excluded_ingredients || [],
        required_ingredients: args.included_ingredients || [],
      }
      // No intent passed - filtering done in post-processing
    );

    if (milvusResults.length === 0) {
      return {
        recipes: [],
        count: 0,
        message: "No recipes found matching your query",
      };
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

        // Post-filter: Skip recipes with excluded ingredients (partial match)
        if (
          args.excluded_ingredients &&
          args.excluded_ingredients.length > 0 &&
          hasExcludedIngredient(recipe.ingredients, args.excluded_ingredients)
        ) {
          return null;
        }

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
    console.error("[rag_search] Error:", error);
    return {
      recipes: [],
      count: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * SQL Search - Uses exact SQL filters for hard constraints
 */
export async function executeSQLSearch(
  args: SqlSearchArgs
): Promise<ToolResult> {
  console.log(
    "[SQLSearch] Tool called - Arguments:",
    JSON.stringify(args, null, 2)
  );
  try {
    const {
      excluded_ingredients = [],
      max_time_minutes,
      difficulty,
      cuisine,
      limit = 10,
      included_ingredients,
      macronutrients,
      price_constraints,
      seasonality,
    } = args;

    const conditions: string[] = [
      `r.status = 'published'`,
      `r."deletedAt" IS NULL`,
    ];

    const queryParams: (string | number)[] = [];
    let paramIndex = 1;

    // Use ILIKE for partial matching of excluded ingredients
    if (excluded_ingredients && excluded_ingredients.length > 0) {
      const excludeResult = buildExcludedIngredientsCondition(
        excluded_ingredients,
        paramIndex
      );
      if (excludeResult.condition) {
        conditions.push(excludeResult.condition);
        queryParams.push(...excludeResult.params);
        paramIndex = excludeResult.nextParamIndex;
      }
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

    // Increase limit if we need to filter/sort by macronutrients, price, or seasonality
    const queryLimit =
      macronutrients || price_constraints || seasonality ? limit * 3 : limit;
    queryParams[queryParams.length - 1] = queryLimit; // Update the limit parameter

    const recipes = await AppDataSource.query(
      `
      SELECT r.id, r.name AS recipe_name, r.slug, r.ingress, r.difficulty, 
             r.servings, r."prepTime", r."cookTime", r.meta,
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

    console.log("[SQLSearch] Raw recipes from DB:", recipes.length);
    if (recipes.length > 0) {
      console.log("[SQLSearch] First recipe:", recipes[0]?.recipe_name);
    }

    // Helper function to calculate macronutrient match score
    const calculateMacroScore = (
      meta: string | null,
      macronutrients?: Record<string, "high" | "low">
    ): number => {
      if (!macronutrients || !meta) return 0;

      try {
        const metaData = JSON.parse(meta);
        const macros = metaData?.macros || {};
        let score = 0;
        let totalChecks = 0;

        for (const [nutrient, preference] of Object.entries(macronutrients)) {
          totalChecks++;
          const nutrientKey = nutrient.toLowerCase().replace(/[^a-z0-9]/g, "_");
          const value = macros[nutrientKey] || macros[nutrient] || 0;

          // Normalize nutrient values for comparison (using common thresholds)
          const thresholds: Record<string, { high: number; low: number }> = {
            protein: { high: 20, low: 10 },
            carbohydrates: { high: 50, low: 20 },
            fat: { high: 20, low: 5 },
            calories: { high: 500, low: 200 },
            fiber: { high: 5, low: 2 },
            sugar: { high: 20, low: 5 },
          };

          const threshold = thresholds[nutrientKey] ||
            thresholds[nutrient] || { high: value * 1.5, low: value * 0.5 };

          if (preference === "high" && value >= threshold.high) {
            score += 1;
          } else if (preference === "low" && value <= threshold.low) {
            score += 1;
          } else if (preference === "high" && value > threshold.low) {
            // Partial match - closer to high threshold
            score += (value - threshold.low) / (threshold.high - threshold.low);
          } else if (preference === "low" && value < threshold.high) {
            // Partial match - closer to low threshold
            score +=
              (threshold.high - value) / (threshold.high - threshold.low);
          }
        }

        return totalChecks > 0 ? score / totalChecks : 0;
      } catch (error) {
        console.error("[SQLSearch] Error parsing meta for macro score:", error);
        return 0;
      }
    };

    // Helper function to check price constraints
    const matchesPriceConstraint = (
      meta: string | null,
      priceConstraints?: { min: number; max: number }
    ): boolean => {
      if (!priceConstraints || !meta) return true;

      try {
        const metaData = JSON.parse(meta);
        const prices = metaData?.prices || {};

        // Check all three price markets (indianPrice, norwegianPrice, americanPrice)
        const priceValues = [
          prices.indianPrice,
          prices.norwegianPrice,
          prices.americanPrice,
        ].filter((p) => typeof p === "number" && p > 0);

        if (priceValues.length === 0) return true; // No price data, don't filter out

        // Recipe matches if ANY price market falls within the range
        return priceValues.some(
          (price) =>
            price >= priceConstraints.min && price <= priceConstraints.max
        );
      } catch (error) {
        console.error(
          "[SQLSearch] Error parsing meta for price constraint:",
          error
        );
        return true; // Don't filter out if we can't parse
      }
    };

    // Helper function to check seasonality
    const matchesSeasonality = (
      meta: string | null,
      seasonality?: string[]
    ): boolean => {
      if (!seasonality || seasonality.length === 0 || !meta) return true;

      try {
        const metaData = JSON.parse(meta);
        const recipeSeasonality = metaData?.seasonality || [];

        if (
          !Array.isArray(recipeSeasonality) ||
          recipeSeasonality.length === 0
        ) {
          return true; // No seasonality data, don't filter out
        }

        // Normalize both arrays to lowercase for comparison
        const normalizedRecipeSeasons = recipeSeasonality.map((s: string) =>
          s.toLowerCase().trim()
        );
        const normalizedRequestedSeasons = seasonality.map((s: string) =>
          s.toLowerCase().trim()
        );

        // Recipe matches if ANY requested seasonality is in the recipe's seasonality
        return normalizedRequestedSeasons.some((requestedSeason) =>
          normalizedRecipeSeasons.includes(requestedSeason)
        );
      } catch (error) {
        console.error("[SQLSearch] Error parsing meta for seasonality:", error);
        return true; // Don't filter out if we can't parse
      }
    };

    // Filter and sort recipes based on macronutrients, price constraints, and seasonality
    let filteredRecipes = recipes;

    // Filter by price constraints
    if (price_constraints) {
      filteredRecipes = filteredRecipes.filter((r: any) =>
        matchesPriceConstraint(r.meta, price_constraints)
      );
    }

    // Filter by seasonality
    if (seasonality && seasonality.length > 0) {
      filteredRecipes = filteredRecipes.filter((r: any) =>
        matchesSeasonality(r.meta, seasonality)
      );
    }

    // Sort by macronutrient match score if macronutrients specified
    if (macronutrients && Object.keys(macronutrients).length > 0) {
      filteredRecipes = filteredRecipes
        .map((r: any) => ({
          ...r,
          macroScore: calculateMacroScore(r.meta, macronutrients),
        }))
        .sort((a: any, b: any) => b.macroScore - a.macroScore)
        .slice(0, limit);
    } else {
      filteredRecipes = filteredRecipes.slice(0, limit);
    }

    const formattedRecipes = filteredRecipes.map((r: any) => ({
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

    const toolResult = {
      recipes: formattedRecipes,
      count: formattedRecipes.length,
      message: `Found ${formattedRecipes.length} recipe(s) matching all specified constraints`,
      filters_applied: {
        excluded_ingredients:
          excluded_ingredients.length > 0 ? excluded_ingredients : undefined,
        included_ingredients:
          included_ingredients && included_ingredients.length > 0
            ? included_ingredients
            : undefined,
        max_time_minutes: max_time_minutes || undefined,
        difficulty: difficulty || undefined,
        cuisine: cuisine || undefined,
        price_constraints: price_constraints || undefined,
        macronutrients: macronutrients || undefined,
        seasonality:
          seasonality && seasonality.length > 0 ? seasonality : undefined,
      },
    };

    return toolResult;
  } catch (error) {
    console.error("[sql_search] Error:", error);
    return {
      recipes: [],
      count: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Hybrid Search - Combines semantic similarity with hard constraints
 */
export async function executeHybridSearch(
  args: HybridSearchArgs
): Promise<ToolResult> {
  console.log(
    "[HybridSearch] Tool called - Arguments:",
    JSON.stringify(args, null, 2)
  );
  try {
    const {
      query,
      excluded_ingredients = [],
      included_ingredients = [],
      max_time_minutes,
      difficulty,
      cuisine,
      limit = 10,
      price_constraints,
      macronutrients,
      seasonality,
    } = args;

    const ollama = new OllamaService();
    const milvus = new MilvusService();

    const queryEmbedding = await ollama.embed(query);

    // Don't filter excluded_ingredients at Milvus level - it's too restrictive
    // We handle excluded_ingredients filtering in post-processing instead
    const milvusLimit = Math.max(limit * 3, 50);
    const milvusResults = await milvus.searchSimilarRecipes(
      queryEmbedding,
      milvusLimit
      // No intent passed - filtering done in post-processing
    );

    if (milvusResults.length === 0) {
      return {
        recipes: [],
        count: 0,
        message: "No recipes found matching your query and constraints",
      };
    }

    const recipeIds = milvusResults.map((r: MilvusResult) => r.recipe_id);

    const conditions: string[] = [
      `r.id = ANY($1::uuid[])`,
      `r.status = 'published'`,
      `r."deletedAt" IS NULL`,
    ];

    const queryParams: (string | number | string[])[] = [recipeIds];
    let paramIndex = 2;

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

    // Require included ingredients if specified
    if (included_ingredients && included_ingredients.length > 0) {
      const includeConditions: string[] = [];
      for (let i = 0; i < included_ingredients.length; i++) {
        const paramIdx = paramIndex + i;
        includeConditions.push(`LOWER(i.name) ILIKE $${paramIdx}`);
        queryParams.push(`%${included_ingredients[i].toLowerCase().trim()}%`);
      }
      conditions.push(`
        EXISTS (
          SELECT 1
          FROM recipe_ingredient ri
          INNER JOIN ingredient i ON ri."ingredientId" = i.id
          WHERE ri."recipeId" = r.id
            AND ri."deletedAt" IS NULL
            AND (${includeConditions.join(" OR ")})
        )
      `);
      paramIndex += included_ingredients.length;
    }

    // Increase limit if we need to filter/sort by macronutrients, price, or seasonality
    const queryLimit =
      macronutrients || price_constraints || seasonality
        ? limit * 5
        : limit * 3;
    queryParams.push(queryLimit);

    const whereClause = conditions.join(" AND ");

    const recipes = await AppDataSource.query(
      `
      SELECT r.id, r.name AS recipe_name, r.slug, r.ingress, r.difficulty, 
             r.servings, r."prepTime", r."cookTime", r.meta,
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

    const recipeMap = new Map<string, RecipeRow>(
      recipes.map((r: RecipeRow) => [r.id, r])
    );
    const milvusMap = new Map<string, MilvusResult>(
      milvusResults.map((r: MilvusResult) => [r.recipe_id, r])
    );

    // Helper function to calculate macronutrient match score (same as SQL search)
    const calculateMacroScore = (
      meta: string | null,
      macronutrients?: Record<string, "high" | "low">
    ): number => {
      if (!macronutrients || !meta) return 0;

      try {
        const metaData = JSON.parse(meta);
        const macros = metaData?.macros || {};
        let score = 0;
        let totalChecks = 0;

        for (const [nutrient, preference] of Object.entries(macronutrients)) {
          totalChecks++;
          const nutrientKey = nutrient.toLowerCase().replace(/[^a-z0-9]/g, "_");
          const value = macros[nutrientKey] || macros[nutrient] || 0;

          // Normalize nutrient values for comparison (using common thresholds)
          const thresholds: Record<string, { high: number; low: number }> = {
            protein: { high: 20, low: 10 },
            carbohydrates: { high: 50, low: 20 },
            fat: { high: 20, low: 5 },
            calories: { high: 500, low: 200 },
            fiber: { high: 5, low: 2 },
            sugar: { high: 20, low: 5 },
          };

          const threshold = thresholds[nutrientKey] ||
            thresholds[nutrient] || { high: value * 1.5, low: value * 0.5 };

          if (preference === "high" && value >= threshold.high) {
            score += 1;
          } else if (preference === "low" && value <= threshold.low) {
            score += 1;
          } else if (preference === "high" && value > threshold.low) {
            // Partial match - closer to high threshold
            score += Math.min(
              1,
              (value - threshold.low) / (threshold.high - threshold.low)
            );
          } else if (preference === "low" && value < threshold.high) {
            // Partial match - closer to low threshold
            score += Math.min(
              1,
              (threshold.high - value) / (threshold.high - threshold.low)
            );
          }
        }

        return totalChecks > 0 ? score / totalChecks : 0;
      } catch (error) {
        console.error(
          "[HybridSearch] Error parsing meta for macro score:",
          error
        );
        return 0;
      }
    };

    // Helper function to check price constraints (same as SQL search)
    const matchesPriceConstraint = (
      meta: string | null,
      priceConstraints?: { min: number; max: number }
    ): boolean => {
      if (!priceConstraints || !meta) return true;

      try {
        const metaData = JSON.parse(meta);
        const prices = metaData?.prices || {};

        // Check all three price markets (indianPrice, norwegianPrice, americanPrice)
        const priceValues = [
          prices.indianPrice,
          prices.norwegianPrice,
          prices.americanPrice,
        ].filter((p) => typeof p === "number" && p > 0);

        if (priceValues.length === 0) return true; // No price data, don't filter out

        // Recipe matches if ANY price market falls within the range
        return priceValues.some(
          (price) =>
            price >= priceConstraints.min && price <= priceConstraints.max
        );
      } catch (error) {
        console.error(
          "[HybridSearch] Error parsing meta for price constraint:",
          error
        );
        return true; // Don't filter out if we can't parse
      }
    };

    // Helper function to check seasonality (same as SQL search)
    const matchesSeasonality = (
      meta: string | null,
      seasonality?: string[]
    ): boolean => {
      if (!seasonality || seasonality.length === 0 || !meta) return true;

      try {
        const metaData = JSON.parse(meta);
        const recipeSeasonality = metaData?.seasonality || [];

        if (
          !Array.isArray(recipeSeasonality) ||
          recipeSeasonality.length === 0
        ) {
          return true; // No seasonality data, don't filter out
        }

        // Normalize both arrays to lowercase for comparison
        const normalizedRecipeSeasons = recipeSeasonality.map((s: string) =>
          s.toLowerCase().trim()
        );
        const normalizedRequestedSeasons = seasonality.map((s: string) =>
          s.toLowerCase().trim()
        );

        // Recipe matches if ANY requested seasonality is in the recipe's seasonality
        return normalizedRequestedSeasons.some((requestedSeason) =>
          normalizedRecipeSeasons.includes(requestedSeason)
        );
      } catch (error) {
        console.error(
          "[HybridSearch] Error parsing meta for seasonality:",
          error
        );
        return true; // Don't filter out if we can't parse
      }
    };

    let filteredOutCount = 0;
    let recipesWithSimilarity: RecipeWithSimilarity[] = recipeIds
      .map((id: string): RecipeWithSimilarity | null => {
        const recipe = recipeMap.get(id);
        const milvusResult = milvusMap.get(id);
        if (!recipe) return null;

        // Post-filter: Skip recipes with excluded ingredients (partial match)
        if (
          excluded_ingredients &&
          excluded_ingredients.length > 0 &&
          hasExcludedIngredient(recipe.ingredients, excluded_ingredients)
        ) {
          filteredOutCount++;
          return null;
        }

        // Post-filter: Check price constraints
        if (
          price_constraints &&
          !matchesPriceConstraint((recipe as any).meta, price_constraints)
        ) {
          filteredOutCount++;
          return null;
        }

        // Post-filter: Check seasonality
        if (
          seasonality &&
          seasonality.length > 0 &&
          !matchesSeasonality((recipe as any).meta, seasonality)
        ) {
          filteredOutCount++;
          return null;
        }

        const macroScore = calculateMacroScore(
          (recipe as any).meta,
          macronutrients
        );

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
          macroScore, // Add macro score for sorting
        } as RecipeWithSimilarity & { macroScore: number };
      })
      .filter(
        (r: RecipeWithSimilarity | null): r is RecipeWithSimilarity =>
          r !== null
      );

    // Sort by macronutrient match score if specified, then by similarity
    if (macronutrients && Object.keys(macronutrients).length > 0) {
      recipesWithSimilarity = (recipesWithSimilarity as any[])
        .sort((a: any, b: any) => {
          // First sort by macro score (descending)
          if (b.macroScore !== a.macroScore) {
            return b.macroScore - a.macroScore;
          }
          // Then by similarity (descending)
          return (b.similarity || 0) - (a.similarity || 0);
        })
        .slice(0, limit);
    } else {
      // Sort by similarity only
      recipesWithSimilarity = recipesWithSimilarity
        .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
        .slice(0, limit);
    }

    return {
      recipes: recipesWithSimilarity,
      count: recipesWithSimilarity.length,
      message: `Found ${recipesWithSimilarity.length} recipe(s) matching your mood ("${query}") and constraints`,
      filters_applied: {
        semantic_query: query,
        excluded_ingredients:
          excluded_ingredients.length > 0 ? excluded_ingredients : undefined,
        included_ingredients:
          included_ingredients && included_ingredients.length > 0
            ? included_ingredients
            : undefined,
        max_time_minutes: max_time_minutes || undefined,
        difficulty: difficulty || undefined,
        cuisine: cuisine || undefined,
        price_constraints: price_constraints || undefined,
        macronutrients: macronutrients || undefined,
        seasonality:
          seasonality && seasonality.length > 0 ? seasonality : undefined,
      },
    };
  } catch (error) {
    console.error("[hybrid_search] Error:", error);
    return {
      recipes: [],
      count: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Execute a tool by name with given arguments
 */
export async function executeToolByName(
  toolName: string,
  args: Record<string, any>
): Promise<ToolResult> {
  switch (toolName) {
    case "rag_search":
      return executeRAGSearch(args as RAGSearchArgs);
    case "sql_search":
      return executeSQLSearch(args as SqlSearchArgs);
    case "hybrid_search":
      return executeHybridSearch(args as HybridSearchArgs);
    default:
      return {
        recipes: [],
        count: 0,
        error: `Unknown tool: ${toolName}`,
      };
  }
}
