import { LlmService } from "./llm.service";
import { SimpleIntent } from "./milvus.service";

export class OrchestratorService {
  private llmService: LlmService;

  constructor() {
    this.llmService = new LlmService();
  }

  normalize(s: string): string {
    return s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  async extractUserIntent(userMessage: string): Promise<SimpleIntent> {
    try {
      const intent = await this.llmService.extractIntentGroq(userMessage);

      return {
        required_ingredients: intent.required_ingredients?.map(this.normalize),
        excluded_ingredients: intent.excluded_ingredients?.map(this.normalize),
      };
    } catch (error) {
      console.error("Error extracting user intent:", error);
      throw new Error(`Intent extraction failed: ${error}`);
    }
  }
}
