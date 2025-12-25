import { OllamaRAGService } from "./ollama-rag.service";
import { LangchainChatService } from "./langchain.service";
import { runRecipeAgent } from "../tools/agent-runner";
import { runGroqRecipeAgent } from "../tools/groq-agent-runner";

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
        const previousMessages = await lc.getPreviousMessages(userId);
        const result = await runGroqRecipeAgent(query, undefined, previousMessages);
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
    const lc = new LangchainChatService();
    const history = await lc.getPreviousMessages(userId);

    // Run Groq agent search
    const result = await runGroqRecipeAgent(message, undefined, history);

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
}
