import { ChatPerplexity } from "@langchain/community/chat_models/perplexity";
import { createAgent, tool } from "langchain";
import { ChatOpenAI } from "@langchain/openai";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { ConversationTokenBufferMemory } from "@langchain/classic/memory";
import { SqlDatabase } from "@langchain/classic/sql_db";
import { DataSource } from "typeorm";

export class LangchainChatService {
  private static instances: Map<string, ConversationTokenBufferMemory> =
    new Map();
  private llm: ChatPerplexity;
  private openai: ChatOpenAI;
  private dataSource: DataSource;

  constructor() {
    this.llm = new ChatPerplexity({
      apiKey: process.env.PERPLEXITY_API_KEY,
      model: "llama3.1:8b",
    });
    this.openai = new ChatOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      model: "gpt-4o-mini",
      temperature: 0.7,
    });
    this.dataSource = new DataSource({
      type: "postgres",
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || "5432"),
      username: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      ssl:
        process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
    });
    this.dataSource.initialize();
  }

  getMemoryFor(userUid: string): ConversationTokenBufferMemory {
    // Normalize userUid to ensure consistent string matching
    const normalizedUid = String(userUid).trim();

    let mem = LangchainChatService.instances.get(normalizedUid);
    if (!mem) {
      mem = new ConversationTokenBufferMemory({
        llm: this.llm,
        memoryKey: "history",
        returnMessages: true,
        inputKey: "input",
        outputKey: "output",
      });
      LangchainChatService.instances.set(normalizedUid, mem);
    }
    return mem;
  }

  async getPreviousMessages(userUid: string) {
    // Normalize userUid to ensure consistent string matching
    const normalizedUid = String(userUid).trim();

    const memory = this.getMemoryFor(normalizedUid);
    const vars = await memory.loadMemoryVariables({});
    const history = (vars["history"] as (AIMessage | HumanMessage)[]) || [];
    return history;
  }

  async generateReply(
    userUid: string,
    systemPrompt: string,
    userMessage: string
  ): Promise<{ content: string; memory: ConversationTokenBufferMemory }> {
    const memory = this.getMemoryFor(userUid);
    const vars = await memory.loadMemoryVariables({});
    const history = (vars["history"] as (AIMessage | HumanMessage)[]) || [];

    const messages = [
      new SystemMessage(systemPrompt),
      ...history,
      new HumanMessage(userMessage),
    ];

    const result = await this.llm.invoke(messages);

    const content = (() => {
      const c: any = (result as any)?.content;
      if (typeof c === "string") return c;
      if (Array.isArray(c))
        return c
          .map((p: any) => (typeof p === "string" ? p : p?.text ?? ""))
          .join("");
      return String(c ?? "");
    })();

    await memory.saveContext({ input: userMessage }, { output: content });
    return { content, memory };
  }

  async getRecipes(query: string, userId: string) {
    try {
      const toolkit = SqlDatabase.fromDataSourceParams({
        appDataSource: this.dataSource,
      });
      const agent = createAgent({
        model: this.openai,
       
        systemPrompt: `You are a friendly and helpful culinary assistant. Your goal is to recommend recipes based on the user's request. Never say 'I don't know' without searching the 'recipe', 'ingredient', and 'recipe_ingredient' tables first. If the user asks for something abstract (e.g., 'refreshing', 'spicy', 'cold'), search for these terms in the \`name\`, \`ingress\`, and \`description\` columns using \`ILIKE\`. If the database is PostgreSQL, always use double quotes for column names that are not all-lowercase (e.g., \"recipeId\"). Do not use backslashes for escaping.`,
      });
      console.warn("getRecipes method not yet implemented");
      return {
        success: false,
        recipes: [],
        output: "getRecipes method not yet implemented",
      };
    } catch (error) {
      console.error("Error in getRecipes:", error);
      return {
        success: false,
        recipes: [],
        output: "Error in getRecipes",
      };
    }
  }
}
