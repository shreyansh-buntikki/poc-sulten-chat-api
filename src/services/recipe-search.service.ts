import { OllamaRAGService } from "./ollama-rag.service";
import { LangchainChatService } from "./langchain.service";
import { runRecipeAgent } from "../tools/agent-runner";
import { runGroqRecipeAgent } from "../tools/groq-agent-runner";
import { LlmService } from "./llm.service";
import { AppDataSource } from "../db";

export class RecipeSearchService {
  /**
   * Get recipes using RAG, with fallback to agent search if Ollama unavailable
   */
  static async getRecipes(query: string, userId: string) {
    const lc = new LangchainChatService();
    let recipes: any[] = [];

    // Try Ollama RAG first, fall back to agent search if Ollama unavailable
    try {
      const ragService = new OllamaRAGService();
      const ragResult = await ragService.runRAG(
        query,
        userId ?? "00DLyaukerYEGpYXYF3ALnSJc0a2"
      );
      recipes = ragResult.similarRecipes;
    } catch (error: any) {
      // If Ollama unavailable (ECONNREFUSED), use agent search instead
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
  static async searchWithOpenAIAgent(message: string, userId: string) {
    const llmService = new LlmService();
    const lc = new LangchainChatService();

    const history = await lc.getPreviousMessages(userId);
    const lastAIMessage = history
      .filter((m: any) => m._getType() === "ai")
      .slice(-1)[0];

    const lastAIContent = lastAIMessage
      ? typeof lastAIMessage.content === "string"
        ? lastAIMessage.content
        : String(lastAIMessage.content)
      : null;

    // 1) Topic check – ensure this is still about food / cooking
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

    const topicCheckResponse = await llmService.chatOpenAI(
      "",
      topicCheckPrompt,
      []
    );
    const topicCheckResult = topicCheckResponse.choices?.[0]?.message?.content
      ?.trim()
      .toUpperCase();

    if (topicCheckResult !== "YES") {
      const nonFoodResponse = await llmService.chatOpenAI(
        "You are Sulten, a friendly cooking assistant. Politely redirect non-food related questions back to cooking topics.",
        message,
        history
      );
      return {
        response:
          nonFoodResponse.choices?.[0]?.message?.content ??
          "I'm here to help with recipes and cooking! How can I assist you with food today?",
        recipes: [],
        noResults: true,
        count: 0,
        previousMessages: history.map((m: any) => ({
          role: m._getType() === "human" ? "user" : "assistant",
          content:
            typeof m.content === "string" ? m.content : String(m.content),
        })),
        provider: "openai",
      };
    }

    // 2) Decide via LLM whether this is a follow-up about previous recipes
    //    or a request for new recipes.
    let usePreviousContext = false;

    if (lastAIContent) {
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

      const followUpResponse = await llmService.chatOpenAI(
        "",
        followUpPrompt,
        []
      );
      const followUpResult =
        followUpResponse.choices?.[0]?.message?.content?.trim().toUpperCase() ??
        "";

      usePreviousContext = followUpResult === "FOLLOW_UP";
    }

    // 3) Either reuse previous assistant context or run a new agent search
    let result:
      | {
          recipes: any[];
          noResults: boolean;
          toolUsed?: string;
          result?: any;
        }
      | undefined;

    const ragService = new OllamaRAGService();
    let context: string;
    let recipesForContext: any[];

    if (usePreviousContext && lastAIContent) {
      // Do NOT run a new search. Use the last assistant message as context.
      // The formatter prompt will strictly forbid creating new recipes/ingredients.
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
      // Normal path: run the OpenAI agent which chooses sql/rag/hybrid tools.
      result = await runRecipeAgent(message);
      context = OllamaRAGService.buildRecipeContext(result.recipes);
      recipesForContext = result.recipes;
    }

    console.log("recipesForContext", recipesForContext.length, result.recipes.length);

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
      result: result.result,
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
      previousMessages: aiResponse.previousMessages.map((m: any) => ({
        role: m._getType() === "human" ? "user" : "assistant",
        content: typeof m.content === "string" ? m.content : String(m.content),
      })),
      provider: "openai",
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
      previousMessages: aiResponse.previousMessages.map((m: any) => ({
        role: m._getType() === "human" ? "user" : "assistant",
        content: typeof m.content === "string" ? m.content : String(m.content),
      })),
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
