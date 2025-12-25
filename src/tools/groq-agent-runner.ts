import {
  GroqCoordinatorAgent,
  GroqAgentResult,
} from "./groq-coordinator-agent";

/**
 * Run the Groq-based recipe agent
 *
 * This function mirrors the OpenAI agent runner pattern but uses Groq's API.
 * It maintains the same interface for easy swapping between providers.
 *
 * @param userQuery - The user's recipe search query
 * @param model - Optional Groq model to use (default: llama-3.3-70b-versatile)
 * @returns Object containing recipes array and noResults flag
 */
export async function runGroqRecipeAgent(
  userQuery: string,
  model?: string,
  history: any[] = []
): Promise<{
  recipes: any[];
  noResults: boolean;
  toolUsed?: string;
}> {
  try {
    const agent = new GroqCoordinatorAgent(model);
    const result: GroqAgentResult = await agent.run(userQuery, history);

    return {
      recipes: result.recipes || [],
      noResults: result.noResults,
      toolUsed: result.toolUsed,
    };
  } catch (error) {
    console.error("[GroqAgentRunner] Error running recipe agent:", error);
    return {
      recipes: [],
      noResults: true,
    };
  }
}
