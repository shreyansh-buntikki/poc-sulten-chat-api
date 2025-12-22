import { GoogleGenerativeAI } from "@google/generative-ai";

export class EmbeddingsService {
  private genAI: GoogleGenerativeAI;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is required");
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async generateEmbedding(text: string): Promise<number[]> {
    try {
      const model = this.genAI.getGenerativeModel({ model: "embedding-001" });
      const result = await model.embedContent(text);
      return result.embedding.values;
    } catch (error) {
      console.error("Error generating embedding:", error);
      throw new Error(`Failed to generate embedding: ${error}`);
    }
  }

  async generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
    try {
      const model = this.genAI.getGenerativeModel({ model: "embedding-001" });
      const result = await model.batchEmbedContents({
        requests: texts.map((text) => ({ content: text })) as any,
      });
      return result.embeddings.map(
        (embedding: { values: number[] }) => embedding.values
      );
    } catch (error) {
      console.error("Error generating embeddings batch:", error);
      throw new Error(`Failed to generate embeddings batch: ${error}`);
    }
  }

  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error("Vectors must have the same length");
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (normA * normB);
  }

  prepareRecipeText(recipe: {
    name: string;
    ingress?: string;
    difficulty?: string;
    servings?: number;
    prepTime?: number;
    cookTime?: number;
    ingredients?: Array<{ name: string; amount?: number; unit?: string }>;
    instructions?: Array<{ description: string; order: number }>;
  }): string {
    let text = `Recipe: ${recipe.name}`;

    if (recipe.ingress) {
      text += `\nDescription: ${recipe.ingress}`;
    }

    if (recipe.difficulty) {
      text += `\nDifficulty: ${recipe.difficulty}`;
    }

    if (recipe.servings) {
      text += `\nServes: ${recipe.servings}`;
    }

    if (recipe.prepTime || recipe.cookTime) {
      const totalTime = (recipe.prepTime || 0) + (recipe.cookTime || 0);
      text += `\nTotal time: ${totalTime} minutes`;
    }

    if (recipe.ingredients && recipe.ingredients.length > 0) {
      text += `\nIngredients: ${recipe.ingredients
        .map(
          (ing) =>
            `${ing.amount ? ing.amount + " " : ""}${
              ing.unit ? ing.unit + " " : ""
            }${ing.name}`
        )
        .join(", ")}`;
    }

    if (recipe.instructions && recipe.instructions.length > 0) {
      text += `\nInstructions: ${recipe.instructions
        .sort((a, b) => a.order - b.order)
        .map((inst) => inst.description)
        .join(" ")}`;
    }

    return text;
  }
}
