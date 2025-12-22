import { tool } from "@openai/agents";
import {
  executeRAGSearch,
  RAGSearchArgs,
  toolDefinitions,
} from "./shared-tool-functions";

export const ragTool = tool({
  name: toolDefinitions.rag_search.name,
  description: toolDefinitions.rag_search.description,
  parameters: {
    ...toolDefinitions.rag_search.parameters,
    additionalProperties: true as const,
  },
  strict: false as const,
  execute: async (input: unknown) => {
    const args = input as RAGSearchArgs;
    return executeRAGSearch(args);
  },
});
