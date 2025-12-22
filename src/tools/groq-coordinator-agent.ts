import Groq from "groq-sdk";
import { executeToolByName } from "./shared-tool-functions";

const GROQ_API_KEY = process.env.GROQ_API_KEY;

// Coordinator system prompt - same as OpenAI version
const COORDINATOR_SYSTEM_PROMPT = `
You are Sulten, a cooking assistant. Your job is to find recipes from the database.

Rules:
- If the user mentions allergies, strict exclusions, or exact constraints (time, difficulty), use sql_search.
- If the user is vague or mood-based ("something cozy", "light and fresh"), use rag_search.
- If both constraints and mood are present, use hybrid_search.

Always return recipe names and descriptions. Do not invent recipes.
`;

// Groq-compatible tool definitions - minimal to avoid empty string issues
const groqTools: Groq.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "rag_search",
      description:
        "Search recipes semantically. Use for general recipe queries without specific ingredient restrictions.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "What the user wants to cook",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "sql_search",
      description:
        "Filter recipes by excluding specific ingredients. Use when user has allergies or doesn't have certain ingredients.",
      parameters: {
        type: "object",
        properties: {
          excluded_ingredients: {
            type: "array",
            items: { type: "string" },
            description: "Ingredients to exclude from recipes",
          },
        },
        required: ["excluded_ingredients"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hybrid_search",
      description:
        "Combines semantic search with ingredient exclusions. Use when user wants something specific AND has ingredients to avoid.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "What the user wants to cook",
          },
          excluded_ingredients: {
            type: "array",
            items: { type: "string" },
            description: "Ingredients to exclude from recipes",
          },
        },
        required: ["query", "excluded_ingredients"],
      },
    },
  },
];

export interface GroqAgentResult {
  recipes: any[];
  noResults: boolean;
  toolUsed?: string;
  rawResponse?: string;
}

export class GroqCoordinatorAgent {
  private client: Groq;
  private model: string;

  constructor(model: string = "llama-3.3-70b-versatile") {
    if (!GROQ_API_KEY) {
      throw new Error("GROQ_API_KEY environment variable is not set");
    }
    this.client = new Groq({ apiKey: GROQ_API_KEY });
    this.model = model;
  }

  private sanitizeToolArgs(args: Record<string, any>): Record<string, any> {
    const sanitized: Record<string, any> = {};

    for (const [key, value] of Object.entries(args)) {
      if (value === "" || value === null || value === undefined) {
        continue;
      }

      if (Array.isArray(value)) {
        const filteredArray = value.filter(
          (item) => item !== "" && item !== null && item !== undefined
        );
        if (filteredArray.length > 0) {
          sanitized[key] = filteredArray;
        }
        continue;
      }

      if (key === "max_time_minutes" || key === "limit") {
        const numValue = Number(value);
        if (!isNaN(numValue) && numValue > 0) {
          sanitized[key] = numValue;
        }
        continue;
      }

      sanitized[key] = value;
    }

    return sanitized;
  }

  async run(userQuery: string): Promise<GroqAgentResult> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: "system",
            content: COORDINATOR_SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: userQuery,
          },
        ],
        tools: groqTools,
        tool_choice: "auto",
        parallel_tool_calls: false,
      });

      const message = response.choices[0]?.message;

      if (message?.tool_calls && message.tool_calls.length > 0) {
        const toolCall = message.tool_calls[0];
        const toolName = toolCall.function.name;

        let toolArgs: Record<string, any> = {};

        try {
          toolArgs = JSON.parse(toolCall.function.arguments);
        } catch {
          toolArgs = {};
        }

        // Sanitize tool arguments - remove empty strings and convert types
        toolArgs = this.sanitizeToolArgs(toolArgs);

        // Step 3: Execute the tool
        const toolResult = await executeToolByName(toolName, toolArgs);

        console.log(
          `[GroqAgent] Tool: ${toolName} | Recipes: ${toolResult.count}`
        );

        return {
          recipes: toolResult.recipes || [],
          noResults: !toolResult.recipes || toolResult.recipes.length === 0,
          toolUsed: toolName,
          rawResponse: message.content || undefined,
        };
      }

      // If no tool call was made, return empty results
      return {
        recipes: [],
        noResults: true,
        rawResponse: message?.content || undefined,
      };
    } catch (error: any) {
      console.error("[GroqAgent] Error:", error?.message || error);
      throw error;
    }
  }
}

// Export a factory function to create the agent
export function createGroqCoordinatorAgent(
  model?: string
): GroqCoordinatorAgent {
  return new GroqCoordinatorAgent(model);
}
