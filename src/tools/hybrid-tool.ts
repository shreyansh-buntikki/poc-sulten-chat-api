import { tool } from "@openai/agents";
import {
  executeHybridSearch,
  HybridSearchArgs,
  toolDefinitions,
} from "./shared-tool-functions";

/**
 * Hybrid search tool that combines SQL deterministic filtering with RAG semantic search
 *
 * Use when user has both:
 * - Hard constraints (allergies, time limits, difficulty) - MUST be satisfied
 * - Mood-based preferences (semantic queries like "cozy", "comforting") - ranked by relevance
 *
 * How it works:
 * 1. Applies hard constraints (excluded_ingredients) via Milvus filter - guarantees safety
 * 2. Ranks remaining recipes by semantic similarity to query - maximizes relevance
 * 3. Applies additional SQL filters (time, difficulty, cuisine) on filtered results
 * 4. Returns recipes that satisfy both semantic and deterministic constraints
 */
export const hybridTool = tool({
  name: toolDefinitions.hybrid_search.name,
  description: toolDefinitions.hybrid_search.description,
  parameters: {
    ...toolDefinitions.hybrid_search.parameters,
    additionalProperties: true as const,
  },
  strict: false as const,
  execute: async (input: unknown) => {
    const args = input as HybridSearchArgs;
    return executeHybridSearch(args);
  },
});
