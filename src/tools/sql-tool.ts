import { tool } from "@openai/agents";
import {
  executeSQLSearch,
  SqlSearchArgs,
  toolDefinitions,
} from "./shared-tool-functions";

export const sqlTool = tool({
  name: toolDefinitions.sql_search.name,
  description: toolDefinitions.sql_search.description,
  parameters: {
    ...toolDefinitions.sql_search.parameters,
    additionalProperties: true as const,
  },
  strict: false as const,
  execute: async (input: unknown) => {
    const args = input as SqlSearchArgs;
    return executeSQLSearch(args);
  },
});
