import { GoogleGenerativeAI } from "@google/generative-ai";

export class LlmService {
  private genAI: GoogleGenerativeAI;
  private chatModel: any;

  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.AI_KEY!);
    this.chatModel = this.genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
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
}
