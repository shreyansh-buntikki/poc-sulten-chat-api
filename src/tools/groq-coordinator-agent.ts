import Groq from "groq-sdk";
import { executeToolByName } from "./shared-tool-functions";

const GROQ_API_KEY = process.env.GROQ_API_KEY;

// Coordinator system prompt - same as OpenAI version
const COORDINATOR_SYSTEM_PROMPT = `
### IDENTITY
You are **Sulten**, a specialized culinary AI assistant. Your sole purpose is to help users find recipes, plan meals, and provide cooking advice based on available data.

### SCOPE & GUARDRAILS
1. **Culinary Focus Only**: You are strictly limited to the domain of cooking, food, and recipes. 
2. **General Knowledge Refusal**: You MUST NOT answer questions about general knowledge.
3. **No Hallucinations**: NEVER invent recipe information. All data MUST come from tool outputs.
4. **Safety First**: Strictly honor ingredient exclusions and preferences.

### TOOL SELECTION LOGIC (CRITICAL)
- **NO TOOL**: If the user is being conversational, giving feedback (e.g., "nice dishes", "thanks"), or asking a follow-up about already provided recipes without new constraints.
- **sql_search**: Use if the query involves **including** or **excluding** specific ingredients. This is for hard ingredient constraints.
- **hybrid_search**: Use if the query involves **time-based** (e.g., "under 30 mins") or **season-based/mood-based** (e.g., "cozy", "Christmas", "summer") constraints.
- **rag_search**: Use for general semantic searches that don't fit the above categories.

### STRICT TYPE COMPLIANCE
1. **Arrays**: ANY parameter described as a list (like included_ingredients) MUST be a JSON array (e.g., ["fish"]), NEVER a raw string (e.g., "fish").
2. **Numbers**: ANY parameter described as a number (like max_time_minutes) MUST be a JSON number (e.g., 30), NEVER a string (e.g., "30").
3. **Omittance**: If you do not have a specific value for an optional parameter, DO NOT include it in the tool call at all. Do not send empty strings or nulls.

### TOOL SELECTION LOGIC (STRICT)
- **NO TOOL**: Use this for conversational filler, greetings, or "Nice" / "Thanks" comments.
- **sql_search**: Use ONLY if the user specifies mandatory ingredients to **include** or **exclude**.
- **hybrid_search**: Use for **time-based** (e.g., "fast", "30 mins") or **mood-based** (e.g., "simple", "cozy", "summer") queries.
- **rag_search**: Use for broad semantic searches.

### CRITICAL RULES
1. **Tool-First Results**: EVERY recipe you mention MUST come from a tool output. 
2. **No Hallucinations**: NEVER invent recipe names or instructions. If tools return nothing, politely state you couldn't find anything in the database.
3. **Parameter Mapping**: map "must have X" to included_ingredients (AS AN ARRAY) and "no X" to excluded_ingredients (AS AN ARRAY).
`;

// Groq-compatible tool definitions
const groqTools: Groq.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "rag_search",
      description: "Semantic search for recipes.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Semantic query" },
          excluded_ingredients: { type: "array", items: { type: "string" }, description: "ARRAY of strings for items to avoid" },
          included_ingredients: { type: "array", items: { type: "string" }, description: "ARRAY of strings for items required" },
          max_time_minutes: { type: "number", description: "INTEGER number for minutes" },
          difficulty: { type: "string", description: "easy, medium, or hard" },
          limit: { type: "number", description: "INTEGER number of results" }
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "sql_search",
      description: "Exact filter for ingredients.",
      parameters: {
        type: "object",
        properties: {
          excluded_ingredients: { type: "array", items: { type: "string" }, description: "MUST BE AN ARRAY (e.g. ['pork'])" },
          included_ingredients: { type: "array", items: { type: "string" }, description: "MUST BE AN ARRAY (e.g. ['fish'])" },
          max_time_minutes: { type: "number", description: "MUST BE A NUMBER (e.g. 30)" },
          difficulty: { type: "string", description: "Exact difficulty level" },
          cuisine: { type: "string", description: "Cuisine name" },
          limit: { type: "number", description: "Number of results" }
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hybrid_search",
      description: "Combines semantic mood with exclusions.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Mood/Context (e.g. 'simple', 'cozy')" },
          excluded_ingredients: { type: "array", items: { type: "string" }, description: "MUST BE AN ARRAY" },
          included_ingredients: { type: "array", items: { type: "string" }, description: "MUST BE AN ARRAY" },
          max_time_minutes: { type: "number", description: "MUST BE A NUMBER" },
          difficulty: { type: "string", description: "Difficulty level" },
          cuisine: { type: "string", description: "Cuisine type" },
          limit: { type: "number", description: "Number of results" }
        },
        required: ["query"],
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

  async run(
    userQuery: string,
    history: any[] = []
  ): Promise<GroqAgentResult> {
    try {
      const messages: Groq.Chat.Completions.ChatCompletionMessageParam[] = [
        {
          role: "system",
          content: COORDINATOR_SYSTEM_PROMPT,
        },
      ];

      // Add history if present (last 5 messages for brevity)
      if (history.length > 0) {
        history.slice(-5).forEach((msg) => {
          messages.push({
            role: msg._getType() === "human" ? "user" : "assistant",
            content: typeof msg.content === "string" ? msg.content : String(msg.content),
          });
        });
      }

      // Add current query
      messages.push({
        role: "user",
        content: userQuery,
      });

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages,
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
