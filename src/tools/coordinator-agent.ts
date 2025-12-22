import { Agent, Runner } from "@openai/agents";
import { ragTool } from "./rag-tool";
import { sqlTool } from "./sql-tool";
import { hybridTool } from "./hybrid-tool";

export const coordinatorAgent = new Agent({
  name: "recipe_coordinator",
  instructions: `
You are Sulten, a cooking assistant. Your job is to find recipes from the database.

Rules:
- If the user mentions allergies, strict exclusions, or exact constraints (time, difficulty), use sql_search.
- If the user is vague or mood-based ("something cozy", "light and fresh"), use rag_search.
- If both constraints and mood are present, use hybrid_search.

Always return recipe names and descriptions. Do not invent recipes.
  `,
  tools: [sqlTool, ragTool, hybridTool],
});
