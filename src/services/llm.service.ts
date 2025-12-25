import { GoogleGenerativeAI } from "@google/generative-ai";
import { Groq } from "groq-sdk";
import OpenAI from "openai";
import axios from "axios";
import { SimpleIntent } from "./milvus.service";

export class LlmService {
  private genAI: GoogleGenerativeAI;
  private chatModel: any;
  private groq: Groq;
  private openai: OpenAI;

  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.AI_KEY!);
    const modelName = process.env.GEMINI_MODEL || "gemini-1.5-pro";
    this.chatModel = this.genAI.getGenerativeModel({
      model: modelName,
    });
    this.groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
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

  async chatOpenAI(
    systemPrompt: string,
    userMessage: string,
    conversationHistory: any[] = [],
    model: string = "gpt-4o"
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

    const completion = await this.openai.chat.completions.create({
      model: model,
      messages,
    });

    return completion;
  }

  async extractIntentGroq(userMessage: string): Promise<SimpleIntent> {


    const messages: any[] = [
      {
        role: "system",
        content: `You are an intent extractor for a recipe chatbot. Your job is to analyze the user's message and output ONLY:
  - which ingredients MUST be included (required_ingredients)
  - which ingredients MUST be excluded (excluded_ingredients)
  
  Rules:
  - Treat allergies, "no X", "without X", "don't want X" as exclusions.
  - Treat "with X", "I have X", "using X" as required ingredients.
  - Use only ingredient words, no cuisine names or adjectives.
  - Normalize all ingredient names: lowercase, no accents (crème fraîche -> creme fraiche, rødløk -> rodlok).
  - If nothing is mentioned, use empty arrays.
  - Output MUST be valid JSON with exactly these two fields.`,
      },
      {
        role: "user",
        content: userMessage,
      },
    ];

    const completion = await this.groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages,
      temperature: 0.1,
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No content in Groq response");
    }

    try {
      const parsed = JSON.parse(content);
      return {
        required_ingredients: (parsed.required_ingredients || []),
        excluded_ingredients: (parsed.excluded_ingredients || []),
      };
    } catch (error) {
      throw new Error(`Failed to parse JSON from Groq: ${content}`);
    }
  }
}
