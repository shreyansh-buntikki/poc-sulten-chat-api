import { run } from "@openai/agents";
import { coordinatorAgent } from "./coordinator-agent";

export async function runRecipeAgent(userQuery: string): Promise<{
  recipes: any[];
  noResults: boolean;
}> {
  console.log("[Agent] Running coordinator for query:", userQuery);

  try {
    // The agent will automatically decide which tool to call
    const result = await run(coordinatorAgent, userQuery);

    // Extract recipes from the result
    // The result.finalOutput should contain the tool's response
    let recipes: any[] = [];
    let toolResult: any = null;

    // Try to extract from finalOutput
    if (result.finalOutput) {
      try {
        // Try parsing as JSON if it's a string
        toolResult =
          typeof result.finalOutput === "string"
            ? JSON.parse(result.finalOutput)
            : result.finalOutput;
      } catch {
        // If parsing fails, use finalOutput as-is
        toolResult = result.finalOutput;
      }
    }

    // Extract recipes from tool result
    // Tool results typically have structure: { recipes: [...], count: number }
    if (toolResult && typeof toolResult === "object") {
      if (Array.isArray(toolResult.recipes)) {
        recipes = toolResult.recipes;
      } else if (toolResult.recipes && typeof toolResult.recipes === "object") {
        recipes = [toolResult.recipes];
      } else if (Array.isArray(toolResult)) {
        // If toolResult is directly an array
        recipes = toolResult;
      }
    }

    // If no recipes found in finalOutput, check if there's a direct recipes property
    if (recipes.length === 0 && result && typeof result === "object") {
      const resultAny = result as any;
      if (Array.isArray(resultAny.recipes)) {
        recipes = resultAny.recipes;
      }
    }

    return {
      recipes: recipes || [],
      noResults: !recipes || recipes.length === 0,
    };
  } catch (error) {
    console.error("[Agent] Error running recipe agent:", error);
    return {
      recipes: [],
      noResults: true,
    };
  }
}
