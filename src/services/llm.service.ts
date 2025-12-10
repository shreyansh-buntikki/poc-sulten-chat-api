import { GoogleGenerativeAI } from "@google/generative-ai";
import { Groq } from "groq-sdk";
import axios from "axios";

export class LlmService {
  private genAI: GoogleGenerativeAI;
  private chatModel: any;
  private groq: Groq;

  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.AI_KEY!);
    const modelName = process.env.GEMINI_MODEL || "gemini-1.5-pro";
    this.chatModel = this.genAI.getGenerativeModel({
      model: modelName,
    });
    this.groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });
  }

  async chat(
    systemPrompt: string,
    userMessage: string,
    conversationHistory: any[] = []
  ): Promise<string> {
    const contents = [];

    if (conversationHistory && conversationHistory.length > 0) {
      for (const msg of conversationHistory) {
        const role = msg._getType() === "human" ? "user" : "model";
        const content =
          typeof msg.content === "string" ? msg.content : String(msg.content);
        contents.push({
          role: role,
          parts: [{ text: content }],
        });
      }
    }

    contents.push({
      role: "user",
      parts: [{ text: userMessage }],
    });

    const generateConfig: any = {
      contents: contents,
    };

    if (systemPrompt && systemPrompt.trim() !== "") {
      generateConfig.systemInstruction = systemPrompt;
    }

    const result = await this.chatModel.generateContent(generateConfig);

    return result.response.text();
  }

  async chatGroq(
    systemPrompt: string,
    userMessage: string,
    conversationHistory: any[] = []
  ) {
    const messages: any[] = [];

    if (systemPrompt && systemPrompt.trim() !== "") {
      messages.push({
        role: "system",
        content: systemPrompt,
      });
    }

    if (conversationHistory && conversationHistory.length > 0) {
      for (const msg of conversationHistory) {
        const role = msg._getType() === "human" ? "user" : "assistant";
        const content =
          typeof msg.content === "string" ? msg.content : String(msg.content);
        messages.push({
          role,
          content,
        });
      }
    }

    messages.push({
      role: "user",
      content: userMessage,
    });

    const completion = await this.groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages,
    });

    return completion;
  }
}
