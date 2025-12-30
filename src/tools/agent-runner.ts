import { run } from "@openai/agents";
import { coordinatorAgent } from "./coordinator-agent";

export async function runRecipeAgent(userQuery: string): Promise<{
  recipes: any[];
  noResults: boolean;
  toolUsed?: string;
  result?: any;
}> {
  try {
    const result = await run(coordinatorAgent, userQuery);
    const resultAny = result as any;

    let recipes: any[] = [];
    let toolUsed: string | undefined;

    let generatedItems: any[] = [];

    if (
      resultAny?.state?._generatedItems &&
      Array.isArray(resultAny.state._generatedItems)
    ) {
      generatedItems = resultAny.state._generatedItems;
    } else if (
      resultAny?.state?.generatedItems &&
      Array.isArray(resultAny.state.generatedItems)
    ) {
      generatedItems = resultAny.state.generatedItems;
    }

    console.log(`[Agent] Checking ${generatedItems.length} generated items`);

    for (const item of generatedItems) {
      if (item.type === "tool_call_output_item" && item.rawItem) {
        toolUsed = item.rawItem.name;
        console.log(
          `[Agent] Found tool_call_output_item for tool: ${toolUsed}`
        );

        let outputText: string | null = null;

        if (item.rawItem.output) {
          if (
            item.rawItem.output.type === "text" &&
            typeof item.rawItem.output.text === "string"
          ) {
            outputText = item.rawItem.output.text;
            console.log(
              `[Agent] Extracted from rawItem.output.text (length: ${
                outputText!.length
              })`
            );
          }
        }

        if (!outputText && typeof item.output === "string") {
          outputText = item.output;
          console.log(
            `[Agent] Extracted from item.output (length: ${outputText!.length})`
          );
        }

        if (outputText) {
          try {
            const toolResult = JSON.parse(outputText);
            console.log(
              `[Agent] Parsed JSON, recipes array exists: ${Array.isArray(
                toolResult.recipes
              )}`
            );
            if (Array.isArray(toolResult.recipes)) {
              recipes = toolResult.recipes;
              console.log(`[Agent] Extracted ${recipes.length} recipes`);
              break;
            }
          } catch (error) {
            console.error("[Agent] Failed to parse tool output:", error);
            if (outputText) {
              console.error(
                "[Agent] Output text preview:",
                outputText.substring(0, 200)
              );
            }
          }
        } else {
          console.log(
            `[Agent] No output text found. rawItem.output exists: ${!!item
              .rawItem.output}, item.output type: ${typeof item.output}`
          );
        }
      }
    }

    if (toolUsed) {
      console.log(`[Agent] Tool selected: ${toolUsed}`);
    }

    return {
      recipes,
      noResults: recipes.length === 0,
      toolUsed,
      result: resultAny,
    };
  } catch (error) {
    console.error("[Agent] Error running recipe agent:", error);
    return {
      recipes: [],
      noResults: true,
    };
  }
}
