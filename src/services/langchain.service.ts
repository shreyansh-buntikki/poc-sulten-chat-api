import { ChatOllama } from "@langchain/community/chat_models/ollama";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { ConversationTokenBufferMemory } from "langchain/memory";

export class LangchainChatService {
  private static instances: Map<string, ConversationTokenBufferMemory> =
    new Map();
  private llm: ChatOllama;

  constructor() {
    const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
    const model = process.env.OLLAMA_CHAT_MODEL || "gemma3:latest";
    this.llm = new ChatOllama({ baseUrl, model });
  }

  private getMemoryFor(userUid: string): ConversationTokenBufferMemory {
    let mem = LangchainChatService.instances.get(userUid);
    if (!mem) {
      mem = new ConversationTokenBufferMemory({
        llm: this.llm,
        memoryKey: "history",
        returnMessages: true,
        inputKey: "input",
        outputKey: "output",
      });
      LangchainChatService.instances.set(userUid, mem);
    }
    return mem;
  }

  async generateReply(
    userUid: string,
    systemPrompt: string,
    userMessage: string
  ): Promise<string> {
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
    return content;
  }
}
