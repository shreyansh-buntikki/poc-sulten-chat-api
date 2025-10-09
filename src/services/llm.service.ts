import { GoogleGenerativeAI } from '@google/generative-ai';

export class LlmService {
  private genAI: GoogleGenerativeAI;
  private chatModel: any;

  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.AI_KEY!);
    this.chatModel = this.genAI.getGenerativeModel({ 
      model: 'gemini-2.0-flash' 
    });
  }

  async chat(systemPrompt: string, userMessage: string): Promise<string> {
    const prompt = `${systemPrompt}\n\nUser: ${userMessage}`;
    const result = await this.chatModel.generateContent(prompt);
    return result.response.text();
  }
}
