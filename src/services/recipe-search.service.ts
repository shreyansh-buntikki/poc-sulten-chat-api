import { OllamaRAGService } from "./ollama-rag.service";
import { LangchainChatService } from "./langchain.service";
import { runRecipeAgent } from "../tools/agent-runner";
import { runGroqRecipeAgent } from "../tools/groq-agent-runner";
import { LlmService } from "./llm.service";
import { OllamaService } from "./ollama.service";
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

  /**
   * Search recipes using OpenAI agent
   */
  static async searchWithOpenAIAgent(message: string, userId: string) {
    // Run agent search
    const result = await runRecipeAgent(message);

    // Build RAGResult from agent results and use formatAIResponse
    const ragService = new OllamaRAGService();
    const ragResult = OllamaRAGService.buildRAGResultFromRecipes(
      result.recipes
    );

    // Use formatAIResponse with groq model (same as chatAI)
    const aiResponse = await ragService.formatAIResponse(
      message,
      userId,
      "groq",
      ragResult
    );

    return {
      response: aiResponse.content,
      recipes: result.recipes,
      noResults: result.noResults,
      count: result.recipes.length,
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

    // Build RAGResult from agent results and use formatAIResponse
    const ragService = new OllamaRAGService();
    const ragResult = OllamaRAGService.buildRAGResultFromRecipes(
      result.recipes
    );

    // Use formatAIResponse with groq model (same as chatAI)
    const aiResponse = await ragService.formatAIResponse(
      message,
      userId,
      "groq",
      ragResult
    );

    return {
      response: aiResponse.content,
      recipes: result.recipes,
      noResults: result.noResults,
      count: result.recipes.length,
      toolUsed: result.toolUsed,
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
      const ollamaService = new OllamaService();

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

      for (const recipe of recipes) {
        try {
          // Format ingredients for OllamaService
          const formattedIngredients = (recipe.ingredients || []).map(
            (ing: any) => {
              const amount = ing.amount ? String(ing.amount) : "";
              const unit = ing.unit ? String(ing.unit) : "";
              const quantity = [amount, unit].filter(Boolean).join(" ");
              return {
                name: ing.name || "",
                quantity: quantity || ing.name || "",
              };
            }
          );

          // Format instructions for OllamaService
          const formattedInstructions = (recipe.instructions || []).map(
            (inst: any) => ({
              instruction: inst.instruction,
              order: inst.order,
            })
          );

          // Get metadata from Ollama
          const metadata = await ollamaService.getRecipeMetaData({
            recipeName: recipe.recipe_name,
            ingredients: formattedIngredients,
            instructions: formattedInstructions,
          });

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
      };
    } catch (error) {
      console.error("[RecipeSearchService] Error in getRecipesMeta:", error);
      throw error;
    }
  }
}
