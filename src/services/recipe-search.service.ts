import { OllamaRAGService } from "./ollama-rag.service";
import { LangchainChatService } from "./langchain.service";
import { runRecipeAgent } from "../tools/agent-runner";
import { runGroqRecipeAgent } from "../tools/groq-agent-runner";
import { LlmService } from "./llm.service";
import { AppDataSource } from "../db";

export class RecipeSearchService {
  static async getRecipes(query: string, userId: string) {
    const lc = new LangchainChatService();
    let recipes: any[] = [];

    try {
      const ragService = new OllamaRAGService();
      const ragResult = await ragService.runRAG(
        query,
        userId ?? "00DLyaukerYEGpYXYF3ALnSJc0a2"
      );
      recipes = ragResult.similarRecipes;
    } catch (error: any) {
      if (
        error?.cause?.code === "ECONNREFUSED" ||
        error?.message?.includes("ECONNREFUSED") ||
        error?.message?.includes("fetch failed")
      ) {
        console.log(
          "[RecipeSearchService] Ollama unavailable, falling back to agent search"
        );
        const result = await runGroqRecipeAgent(query);
        recipes = result.recipes || [];
      } else {
        throw error;
      }
    }

    const previousMessages = await lc.getPreviousMessages(userId);

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

    return {
      recipes: safeRecipesForVapi,
      noResults: !recipes.length || recipes.length === 0,
      previousContext: previousMessages?.map((item) => {
        return {
          text: item?.content ?? "",
          role: item?._getType() === "human" ? "user" : "assistant",
        };
      }),
    };
  }
  /**
   * Extract the last AI message content from conversation history
   */
  private static getLastAIContent(history: any[]): string | null {
    const lastAIMessage = history
      .filter((m: any) => m._getType() === "ai")
      .slice(-1)[0];

    if (!lastAIMessage) return null;

    return typeof lastAIMessage.content === "string"
      ? lastAIMessage.content
      : String(lastAIMessage.content);
  }

  /**
   * Check if the conversation is about food/recipes/cooking
   */
  private static async checkTopicIsFoodRelated(
    message: string,
    lastAIContent: string | null,
    llmService: LlmService
  ): Promise<boolean> {
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
    Otherwise reply only with "NO".
    
    Answer (YES or NO):
    User message: "${message}"
    `;

    const topicCheckResponse = await llmService.chatOpenAI(
      "",
      topicCheckPrompt,
      []
    );

    const topicCheckResult =
      topicCheckResponse.choices?.[0]?.message?.content?.trim().toUpperCase() ??
      "";

    return topicCheckResult === "YES";
  }

  /**
   * Handle non-food related responses
   */
  private static async handleNonFoodResponse(
    message: string,
    userId: string,
    history: any[],
    llmService: LlmService,
    lc: LangchainChatService
  ) {
    const nonFoodResponse = await llmService.chatOpenAI(
      "You are Sulten, a friendly cooking assistant. Politely redirect non-food related questions back to cooking topics.",
      message,
      history
    );

    const nonFoodContent =
      nonFoodResponse.choices?.[0]?.message?.content ??
      "I'm here to help with recipes and cooking! How can I assist you with food today?";

    // Save user message and AI response to Langchain memory
    const memory = lc.getMemoryFor(userId);
    await memory.saveContext({ input: message }, { output: nonFoodContent });

    // Get updated messages after saving
    const updatedHistory = await lc.getPreviousMessages(userId);

    return {
      response: nonFoodContent,
      recipes: [],
      noResults: true,
      count: 0,
      previousMessages: updatedHistory.map((m: any) => ({
        role: m._getType() === "human" ? "user" : "assistant",
        content: typeof m.content === "string" ? m.content : String(m.content),
      })),
      provider: "openai" as const,
    };
  }

  /**
   * Check if user is asking for follow-up details about previous recipes
   */
  private static async checkIfFollowUp(
    message: string,
    lastAIContent: string,
    llmService: LlmService
  ): Promise<boolean> {
    const followUpPrompt = `You previously answered the user with this message:
\"\"\"${lastAIContent}\"\"\"

Now the user says:
\"\"\"${message}\"\"\"

You are Sulten, a cooking assistant.

If the user is asking for MORE DETAILS about one or more of the recipes you already mentioned
(for example asking for ingredients, cooking steps, instructions, or saying things like
"how do I cook it", "tell me more about it", "what are the ingredients"),
then reply ONLY with the single word: FOLLOW_UP

If the user is instead asking for NEW recipes or something different
(for example a different mood, different constraints, or clearly new suggestions),
then reply ONLY with the single word: NEW_SEARCH

Answer strictly with one word: FOLLOW_UP or NEW_SEARCH.`;

    const followUpResponse = await llmService.chatOpenAI("", followUpPrompt, []);
    const followUpResult =
      followUpResponse.choices?.[0]?.message?.content?.trim().toUpperCase() ??
      "";

    return followUpResult === "FOLLOW_UP";
  }

  /**
   * Search for recipes with fallback logic
   */
  private static async searchRecipesWithFallback(
    message: string
  ): Promise<{
    recipes: any[];
    noResults: boolean;
    toolUsed?: string;
    result?: any;
  }> {
    let result = await runRecipeAgent(message);

    // Fallback logic when no recipes are found
    if (result.noResults && result.recipes.length === 0) {
      let fallbackQuery: string;

      if (result.toolUsed === "sql_search") {
        // Original behavior: if strict SQL search finds nothing, try a more flexible semantic search
        fallbackQuery = `Find recipes matching: "${message}". Use semantic similarity search to find similar recipes even if exact matches don't exist.`;
      } else {
        // New behavior: if rag_search (or anything else) finds nothing, encourage the agent to use SQL / hybrid
        fallbackQuery = `The user asked: "${message}". Choose recipes using sql_search or hybrid_search with appropriate filters (including cuisine / difficulty), and DO NOT use rag_search. Interpret obvious cuisine words even if slightly misspelled (e.g. "italain" = "italian").`;
      }

      const fallbackResult = await runRecipeAgent(fallbackQuery);

      if (
        !fallbackResult.noResults &&
        fallbackResult.recipes.length > 0 &&
        (fallbackResult.toolUsed === "hybrid_search" ||
          fallbackResult.toolUsed === "rag_search" ||
          fallbackResult.toolUsed === "sql_search")
      ) {
        result = fallbackResult;
      } else {
        console.log(
          `[RecipeSearchService] Fallback search returned ${fallbackResult.recipes.length} results (tool: ${fallbackResult.toolUsed})`
        );
      }
    }

    return result;
  }

  /**
   * Format recipes for API response
   */
  private static formatRecipesForResponse(recipes: any[]) {
    return recipes.map((recipe: any) => ({
      id: recipe.id,
      recipe_name: recipe.recipe_name,
      slug: recipe.slug,
      url: `https://sulten.app/en/recipes/${recipe.slug || "no-slug"}`,
      ingress: recipe.ingress,
      difficulty: recipe.difficulty,
      servings: recipe.servings,
      prepTime: recipe.prepTime,
      cookTime: recipe.cookTime,
      total_time: recipe.total_time,
      instructions: recipe.instructions || [],
      ingredients: recipe.ingredients || [],
      similarity: recipe.similarity,
      distance: recipe.distance,
    }));
  }

  /**
   * Format previous messages for response
   */
  private static formatPreviousMessages(messages: any[]) {
    return messages.map((m: any) => ({
      role: m._getType() === "human" ? "user" : "assistant",
      content: typeof m.content === "string" ? m.content : String(m.content),
    }));
  }

  static async searchWithOpenAIAgent(message: string, userId: string) {
    const llmService = new LlmService();
    const lc = new LangchainChatService();
    const ragService = new OllamaRAGService();

    // Get conversation history
    const history = await lc.getPreviousMessages(userId);
    const lastAIContent = RecipeSearchService.getLastAIContent(history);

    // Check if conversation is food-related
    const isFoodRelated = await RecipeSearchService.checkTopicIsFoodRelated(
      message,
      lastAIContent,
      llmService
    );

    if (!isFoodRelated) {
      return await RecipeSearchService.handleNonFoodResponse(
        message,
        userId,
        history,
        llmService,
        lc
      );
    }

    // Check if user is asking for follow-up details
    const usePreviousContext =
      lastAIContent &&
      (await RecipeSearchService.checkIfFollowUp(
        message,
        lastAIContent,
        llmService
      ));

    // Get recipes and context
    let result: {
      recipes: any[];
      noResults: boolean;
      toolUsed?: string;
      result?: any;
    };
    let context: string;
    let recipesForContext: any[];

    if (usePreviousContext && lastAIContent) {
      // Use previous context for follow-up questions
      result = {
        recipes: [],
        noResults: false,
        toolUsed: "previous_context",
        result: null,
      };

      context = `Previously suggested recipes and explanations:
${lastAIContent}

Use ONLY the recipes and information mentioned above when answering the user's follow-up question.
Do NOT search for or invent any new recipes, and do NOT invent new ingredients that were not mentioned before.`;
      recipesForContext = [];
    } else {
      // Search for new recipes
      result = await RecipeSearchService.searchRecipesWithFallback(message);
      context = OllamaRAGService.buildRecipeContext(result.recipes);
      recipesForContext = result.recipes;
    }

    // Build RAG result and generate AI response
    const ragResult = {
      similarRecipes: recipesForContext,
      context,
      userIngredients: [],
      similarRecipesFromMilvus: [],
      recipes: recipesForContext,
      timeToGenerateEmbedding: 0,
      timeToQuery: 0,
    };

    const aiResponse = await ragService.formatAIResponse(
      message,
      userId,
      "openai",
      ragResult
    );

    // Format and return response
    const formattedRecipes =
      RecipeSearchService.formatRecipesForResponse(result.recipes);

    return {
      result: result.result,
      response: aiResponse.content,
      recipes: formattedRecipes,
      originalRecipes: result.recipes?.map((item) => ({
        name: item.recipe_name,
        ingridients: item?.ingredients?.map((ingredient: any) => ingredient.name),
        instructions: item?.instructions,
      })),
      noResults: result.noResults,
      count: result.recipes.length,
      toolUsed: result.toolUsed,
      debug: {
        toolUsed: result.toolUsed,
        recipesFound: result.recipes.length,
        recipesReturned: formattedRecipes.length,
        systemPrompt: aiResponse.systemPrompt,
        conversationContext: aiResponse.conversationContext,
        timeToGenerateAIResponse: aiResponse.timeToGenerateAIResponse,
      },
      previousMessages: RecipeSearchService.formatPreviousMessages(
        aiResponse.previousMessages
      ),
      provider: "openai" as const,
    };
  }

  /**
   * Search recipes using Groq agent
   */
  static async searchWithGroqAgent(message: string, userId: string) {
    // Run Groq agent search
    const result = await runGroqRecipeAgent(message);

    // Build context and RAGResult for formatAIResponse
    const ragService = new OllamaRAGService();
    const context = OllamaRAGService.buildRecipeContext(result.recipes);
    const ragResult = {
      similarRecipes: result.recipes,
      context,
      userIngredients: [],
      similarRecipesFromMilvus: [],
      recipes: result.recipes,
      timeToGenerateEmbedding: 0,
      timeToQuery: 0,
    };

    // Use formatAIResponse with groq model (same as chatAI)
    const aiResponse = await ragService.formatAIResponse(
      message,
      userId,
      "groq",
      ragResult
    );

    // Format recipes with URLs for response
    const formattedRecipes = result.recipes.map((recipe: any) => ({
      id: recipe.id,
      recipe_name: recipe.recipe_name,
      slug: recipe.slug,
      url: `https://sulten.app/en/recipes/${recipe.slug || "no-slug"}`,
      ingress: recipe.ingress,
      difficulty: recipe.difficulty,
      servings: recipe.servings,
      prepTime: recipe.prepTime,
      cookTime: recipe.cookTime,
      total_time: recipe.total_time,
      instructions: recipe.instructions || [],
      ingredients: recipe.ingredients || [],
      similarity: recipe.similarity,
      distance: recipe.distance,
    }));

    return {
      response: aiResponse.content,
      recipes: formattedRecipes,
      originalRecipes: result.recipes, // Original recipes from tool
      noResults: result.noResults,
      count: result.recipes.length,
      toolUsed: result.toolUsed,
      debug: {
        toolUsed: result.toolUsed,
        recipesFound: result.recipes.length,
        recipesReturned: formattedRecipes.length,
        systemPrompt: aiResponse.systemPrompt,
        conversationContext: aiResponse.conversationContext,
        timeToGenerateAIResponse: aiResponse.timeToGenerateAIResponse,
      },
      previousMessages: RecipeSearchService.formatPreviousMessages(
        aiResponse.previousMessages
      ),
      provider: "groq",
    };
  }

  /**
   * Get recipes metadata (macros and prices) for multiple recipes
   */
  static async getRecipesMeta(limit: number) {
    try {
      const llmService = new LlmService();

      // Check if meta column exists, if not add it
      try {
        const columnExists = await AppDataSource.query(
          `SELECT column_name 
           FROM information_schema.columns 
           WHERE table_name = 'recipe' AND column_name = 'meta'`
        );

        if (columnExists.length === 0) {
          console.log(
            "[RecipeSearchService] Adding meta column to recipe table..."
          );
          await AppDataSource.query(`ALTER TABLE recipe ADD COLUMN meta TEXT`);
          console.log("[RecipeSearchService] Meta column added successfully");
        }
      } catch (error) {
        console.error(
          "[RecipeSearchService] Error checking/adding meta column:",
          error
        );
        // Continue anyway - column might already exist or there's a permission issue
      }

      // Fetch recipes with ingredients and instructions
      const recipes = await AppDataSource.query(
        `
        SELECT r.id, r.name AS recipe_name,
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
               ) AS ingredients,
               (
                 SELECT COALESCE(
                   json_agg(
                     json_build_object(
                       'instruction', rin.description,
                       'order', rin."order"
                     ) ORDER BY rin."order"
                   ),
                   '[]'::json
                 )
                 FROM recipe_instruction rin
                 WHERE rin."recipeId" = r.id
                   AND rin."deletedAt" IS NULL
               ) AS instructions
        FROM recipe r
        WHERE r.status = 'published'
          AND r."deletedAt" IS NULL
        ORDER BY r."createdAt" ASC
        LIMIT $1
        `,
        [limit]
      );

      const results = [];
      let totalTokens = {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      };

      for (const recipe of recipes) {
        try {
          // Format ingredients for LlmService
          const formattedIngredients = (recipe.ingredients || []).map(
            (ing: any) => {
              const amount = ing.amount ? String(ing.amount) : "";
              const unit = ing.unit ? String(ing.unit) : "";
              const quantity = [amount, unit].filter(Boolean).join(" ");
              return {
                name: ing.name || "",
                quantity: quantity || ing.name || "",
                unit: unit || "",
              };
            }
          );

          // Format instructions for LlmService
          const formattedInstructions = (recipe.instructions || []).map(
            (inst: any) => ({
              instruction: inst.instruction,
              order: inst.order,
            })
          );

          // Get metadata from ChatGPT API
          const metadata = await llmService.getRecipeMetaData({
            recipeName: recipe.recipe_name,
            ingredients: formattedIngredients,
            instructions: formattedInstructions,
          });

          // Accumulate token usage
          totalTokens.prompt_tokens += metadata.tokens.prompt_tokens;
          totalTokens.completion_tokens += metadata.tokens.completion_tokens;
          totalTokens.total_tokens += metadata.tokens.total_tokens;

          // Stringify metadata and save to database
          const metaString = JSON.stringify({
            macros: metadata.macros,
            prices: metadata.prices,
            seasonality: metadata.seasonality || [],
          });

          // Update the recipe with metadata
          await AppDataSource.query(
            `UPDATE recipe SET meta = $1 WHERE id = $2`,
            [metaString, recipe.id]
          );

          results.push({
            recipeId: recipe.id,
            recipeName: recipe.recipe_name,
            ingredients: recipe.ingredients,
            instructions: recipe.instructions,
            macros: metadata.macros,
            prices: metadata.prices,
            seasonality: metadata.seasonality || [],
          });
        } catch (error) {
          console.error(
            `Error processing recipe ${recipe.recipe_name}:`,
            error
          );
          // Continue with other recipes even if one fails
          results.push({
            recipeId: recipe.id,
            recipeName: recipe.recipe_name,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return {
        success: true,
        processed: results.length,
        recipes: results,
        tokens: totalTokens,
      };
    } catch (error) {
      console.error("[RecipeSearchService] Error in getRecipesMeta:", error);
      throw error;
    }
  }
}
