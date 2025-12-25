import { run } from "@openai/agents";
import { coordinatorAgent } from "./coordinator-agent";

export async function runRecipeAgent(
  userQuery: string,
  history: any[] = []
): Promise<{
  recipes: any[];
  noResults: boolean;
}> {
  console.log("[Agent] Running coordinator for query:", userQuery);

  try {
    const result = await run(coordinatorAgent, userQuery);

    let recipes: any[] = [];
    let toolResult: any = null;
    if (result.finalOutput) {
      try {
        toolResult =
          typeof result.finalOutput === "string"
            ? JSON.parse(result.finalOutput)
            : result.finalOutput;
      } catch {
        toolResult = result.finalOutput;
      }
    }

    if (toolResult && typeof toolResult === "object") {
      if (Array.isArray(toolResult.recipes)) {
        recipes = toolResult.recipes;
      } else if (toolResult.recipes && typeof toolResult.recipes === "object") {
        recipes = [toolResult.recipes];
      } else if (Array.isArray(toolResult)) {
        recipes = toolResult;
      }
    }

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
