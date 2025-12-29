import { run } from "@openai/agents";
import { coordinatorAgent } from "./coordinator-agent";

export async function runRecipeAgent(userQuery: string): Promise<{
  recipes: any[];
  noResults: boolean;
  toolUsed?: string;
  result?: any;
}> {
  console.log("[Agent] Running coordinator for query:", userQuery);

  try {
    const result = await run(coordinatorAgent, userQuery);

    // Log the full result structure
    const resultAny = result as any;
    console.log("[Agent] Full result keys:", Object.keys(resultAny));
    console.log(
      "[Agent] Result has generatedItems?",
      !!resultAny.generatedItems
    );
    console.log("[Agent] Result has toolResults?", !!resultAny.toolResults);
    console.log("[Agent] Result has finalOutput?", !!result.finalOutput);
    console.log("[Agent] Result has state?", !!resultAny.state);

    // Check state for tool results
    if (resultAny.state) {
      console.log("[Agent] state type:", typeof resultAny.state);
      console.log(
        "[Agent] state keys:",
        typeof resultAny.state === "object"
          ? Object.keys(resultAny.state)
          : "N/A"
      );
      if (resultAny.state.generatedItems) {
        console.log(
          "[Agent] state.generatedItems exists, length:",
          Array.isArray(resultAny.state.generatedItems)
            ? resultAny.state.generatedItems.length
            : "not array"
        );
        if (
          Array.isArray(resultAny.state.generatedItems) &&
          resultAny.state.generatedItems.length > 0
        ) {
          console.log(
            "[Agent] state.generatedItems[0]:",
            JSON.stringify(resultAny.state.generatedItems[0], null, 2)
          );
        }
      }
      if (resultAny.state.toolResults) {
        console.log(
          "[Agent] state.toolResults exists, length:",
          Array.isArray(resultAny.state.toolResults)
            ? resultAny.state.toolResults.length
            : "not array"
        );
        if (
          Array.isArray(resultAny.state.toolResults) &&
          resultAny.state.toolResults.length > 0
        ) {
          console.log(
            "[Agent] state.toolResults[0]:",
            JSON.stringify(resultAny.state.toolResults[0], null, 2)
          );
        }
      }
      // Log full state structure (but limit size to avoid huge logs)
      const stateStr = JSON.stringify(resultAny.state, null, 2);
      console.log(
        "[Agent] Full state structure (first 2000 chars):",
        stateStr.substring(0, 2000)
      );
    }

    if (resultAny.generatedItems) {
      console.log(
        "[Agent] generatedItems type:",
        typeof resultAny.generatedItems
      );
      console.log(
        "[Agent] generatedItems is array?",
        Array.isArray(resultAny.generatedItems)
      );
      if (Array.isArray(resultAny.generatedItems)) {
        console.log(
          "[Agent] generatedItems length:",
          resultAny.generatedItems.length
        );
        console.log(
          "[Agent] generatedItems structure:",
          JSON.stringify(resultAny.generatedItems, null, 2)
        );
      }
    }

    let recipes: any[] = [];
    let toolResult: any = null;
    let toolUsed: string | undefined;

    // Try to find tool results in state by searching for common patterns (do this early)
    if (resultAny.state && typeof resultAny.state === "object") {
      // Check for function call results
      const searchForToolResults = (obj: any, path: string = ""): any => {
        if (!obj || typeof obj !== "object") return null;

        // Check if this object looks like a tool result
        if (obj.recipes && Array.isArray(obj.recipes)) {
          console.log(`[Agent] Found recipes at path: ${path}`);
          return obj;
        }

        // Check if this is a function call result
        if (
          obj.name &&
          (obj.name === "sql_search" ||
            obj.name === "rag_search" ||
            obj.name === "hybrid_search")
        ) {
          console.log(
            `[Agent] Found tool call at path: ${path}, name: ${obj.name}`
          );
          if (obj.result) {
            console.log(`[Agent] Found tool result at path: ${path}.result`);
            return obj.result;
          }
          if (obj.output) {
            console.log(`[Agent] Found tool output at path: ${path}.output`);
            return obj.output;
          }
        }

        // Recursively search
        for (const key in obj) {
          if (obj.hasOwnProperty(key)) {
            const found = searchForToolResults(
              obj[key],
              path ? `${path}.${key}` : key
            );
            if (found) return found;
          }
        }
        return null;
      };

      const foundResult = searchForToolResults(resultAny.state);
      if (foundResult) {
        console.log("[Agent] Found tool result via recursive search!");
        // Check if it's wrapped in { type: "text", text: "..." } format
        if (
          foundResult.type === "text" &&
          foundResult.text &&
          typeof foundResult.text === "string"
        ) {
          console.log(
            "[Agent] Tool result is wrapped in text object, parsing text property..."
          );
          try {
            toolResult = JSON.parse(foundResult.text);
            console.log("[Agent] ✅ Parsed text property successfully!");
            console.log(
              "[Agent] Recipes count:",
              toolResult?.recipes?.length || 0
            );
            // Extract tool name from the state if available
            if (!toolUsed) {
              const stateStr = JSON.stringify(resultAny.state);
              if (stateStr.includes('"name":"rag_search"'))
                toolUsed = "rag_search";
              else if (stateStr.includes('"name":"sql_search"'))
                toolUsed = "sql_search";
              else if (stateStr.includes('"name":"hybrid_search"'))
                toolUsed = "hybrid_search";
            }
          } catch (parseError) {
            console.error(
              "[Agent] ❌ Failed to parse text property:",
              parseError
            );
            toolResult = foundResult;
          }
        } else if (foundResult.recipes && Array.isArray(foundResult.recipes)) {
          // Already has recipes array, use it directly
          console.log(
            "[Agent] Found result already has recipes array, using directly"
          );
          toolResult = foundResult;
        } else {
          toolResult = foundResult;
        }
      }
    }

    // First check state.generatedItems (newer OpenAI agents SDK structure)
    const itemsToCheck =
      resultAny.state?.generatedItems || resultAny.generatedItems || [];
    console.log(
      "[Agent] Items to check (from state or root):",
      itemsToCheck.length
    );

    // Check generatedItems for tool call outputs (OpenAI agents SDK structure)
    if (Array.isArray(itemsToCheck) && itemsToCheck.length > 0) {
      console.log("[Agent] Found generatedItems:", itemsToCheck.length);

      // Find tool_call_output_item
      for (let i = 0; i < itemsToCheck.length; i++) {
        const item = itemsToCheck[i];
        console.log(`[Agent] Item ${i} type:`, item.type);
        console.log(`[Agent] Item ${i} keys:`, Object.keys(item));
        if (item.type === "tool_call_output_item") {
          // Extract tool name from rawItem
          if (item.rawItem?.name) {
            toolUsed = item.rawItem.name;
            console.log("[Agent] Tool used:", toolUsed);
          }

          // Log the full item structure for debugging
          console.log(
            "[Agent] Tool output item structure:",
            JSON.stringify(item, null, 2)
          );

          // Extract output - could be in output property or rawItem.output.text
          let outputText: string | null = null;

          if (item.output && typeof item.output === "string") {
            outputText = item.output;
            console.log("[Agent] Found output in item.output (string)");
          } else if (
            item.rawItem?.output?.text &&
            typeof item.rawItem.output.text === "string"
          ) {
            outputText = item.rawItem.output.text;
            console.log(
              "[Agent] Found output in item.rawItem.output.text (string)"
            );
          } else if (
            item.rawItem?.output &&
            typeof item.rawItem.output === "string"
          ) {
            outputText = item.rawItem.output;
            console.log("[Agent] Found output in item.rawItem.output (string)");
          } else if (
            item.rawItem?.output &&
            typeof item.rawItem.output === "object"
          ) {
            // Output might already be an object
            toolResult = item.rawItem.output;
            console.log(
              "[Agent] Found output as object in item.rawItem.output"
            );
          } else if (item.output && typeof item.output === "object") {
            toolResult = item.output;
            console.log("[Agent] Found output as object in item.output");
          }

          if (outputText) {
            console.log("[Agent] Output text length:", outputText.length);
            console.log(
              "[Agent] Output text preview:",
              outputText.substring(0, 200)
            );
            try {
              toolResult = JSON.parse(outputText);
              console.log(
                "[Agent] Parsed tool result, recipes count:",
                toolResult?.recipes?.length || 0
              );
              if (toolResult?.recipes && toolResult.recipes.length > 0) {
                console.log(
                  "[Agent] First recipe name:",
                  toolResult.recipes[0]?.recipe_name
                );
              }
            } catch (parseError) {
              console.error("[Agent] Failed to parse tool output:", parseError);
              console.error(
                "[Agent] Output text that failed to parse:",
                outputText
              );
              // Try to extract as object directly
              try {
                toolResult =
                  typeof item.output === "object"
                    ? item.output
                    : item.rawItem?.output;
                if (toolResult) {
                  console.log(
                    "[Agent] Extracted tool result as object, recipes:",
                    toolResult?.recipes?.length || 0
                  );
                }
              } catch {
                console.error("[Agent] Failed to extract tool result");
              }
            }
          }
          break; // Use first tool result found
        }
      }
    }

    // Fallback: check toolResults (both in state and root)
    if (!toolResult) {
      const toolResults = resultAny.state?.toolResults || resultAny.toolResults;
      if (toolResults && Array.isArray(toolResults) && toolResults.length > 0) {
        toolResult = toolResults[0].result;
        toolUsed = toolResults[0].toolName;
        console.log("[Agent] Found toolResults, tool:", toolUsed);
        console.log(
          "[Agent] toolResult from toolResults:",
          JSON.stringify(toolResult, null, 2)
        );
      }
    }

    // Fallback: check finalOutput
    if (!toolResult && result.finalOutput) {
      try {
        toolResult =
          typeof result.finalOutput === "string"
            ? JSON.parse(result.finalOutput)
            : result.finalOutput;
      } catch {
        toolResult = result.finalOutput;
      }
    }

    // Log toolResult structure before extraction
    console.log("[Agent] toolResult exists?", !!toolResult);
    if (toolResult) {
      console.log("[Agent] toolResult type:", typeof toolResult);
      console.log(
        "[Agent] toolResult keys:",
        typeof toolResult === "object" ? Object.keys(toolResult) : "N/A"
      );
      console.log(
        "[Agent] toolResult has recipes?",
        toolResult?.recipes !== undefined
      );
      if (toolResult?.recipes) {
        console.log(
          "[Agent] toolResult.recipes type:",
          typeof toolResult.recipes
        );
        console.log(
          "[Agent] toolResult.recipes is array?",
          Array.isArray(toolResult.recipes)
        );
        if (Array.isArray(toolResult.recipes)) {
          console.log(
            "[Agent] toolResult.recipes length:",
            toolResult.recipes.length
          );
        }
      }
      console.log(
        "[Agent] Full toolResult:",
        JSON.stringify(toolResult, null, 2)
      );
    }

    // Extract recipes from tool result
    if (toolResult && typeof toolResult === "object") {
      console.log("[Agent] Attempting to extract recipes from toolResult...");

      // Check if toolResult is wrapped in { type: "text", text: "..." } format
      if (
        toolResult.type === "text" &&
        toolResult.text &&
        typeof toolResult.text === "string"
      ) {
        console.log(
          "[Agent] Tool result is wrapped in text object, parsing text property..."
        );
        try {
          const parsed = JSON.parse(toolResult.text);
          if (Array.isArray(parsed.recipes)) {
            recipes = parsed.recipes;
            console.log(
              "[Agent] ✅ Extracted recipes from parsed text.recipes array:",
              recipes.length
            );
          } else if (parsed.recipes && typeof parsed.recipes === "object") {
            recipes = [parsed.recipes];
            console.log(
              "[Agent] ✅ Extracted recipes from parsed text.recipes object:",
              recipes.length
            );
          } else {
            console.log("[Agent] Parsed text doesn't have recipes property");
          }
        } catch (parseError) {
          console.error(
            "[Agent] ❌ Failed to parse text property:",
            parseError
          );
        }
      } else if (Array.isArray(toolResult.recipes)) {
        recipes = toolResult.recipes;
        console.log(
          "[Agent] Extracted recipes from toolResult.recipes array:",
          recipes.length
        );
      } else if (toolResult.recipes && typeof toolResult.recipes === "object") {
        recipes = [toolResult.recipes];
        console.log(
          "[Agent] Extracted recipes from toolResult.recipes object:",
          recipes.length
        );
      } else if (Array.isArray(toolResult)) {
        recipes = toolResult;
        console.log(
          "[Agent] Extracted recipes from toolResult array:",
          recipes.length
        );
      } else {
        console.log(
          "[Agent] toolResult structure doesn't match expected format"
        );
      }
    } else {
      console.log("[Agent] No toolResult or toolResult is not an object");
    }

    // Fallback: check if recipes are directly in result
    if (recipes.length === 0 && result && typeof result === "object") {
      console.log("[Agent] Checking if recipes are directly in result...");
      if (Array.isArray(resultAny.recipes)) {
        recipes = resultAny.recipes;
        console.log(
          "[Agent] Found recipes directly in result:",
          recipes.length
        );
      }
    }

    console.log("[Agent] Final extracted recipes count:", recipes.length);
    if (recipes.length > 0) {
      console.log(
        "[Agent] First recipe:",
        recipes[0]?.recipe_name || recipes[0]?.name
      );
    }

    return {
      recipes: recipes || [],
      noResults: !recipes || recipes.length === 0,
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
