import { AppDataSource } from "../db";
import { LlmService } from "./llm.service";
import { EmbeddingsService } from "./embeddings.service";

export class ChatbotService {
  private llmService: LlmService;
  private embeddingsService: EmbeddingsService;

  constructor() {
    this.llmService = new LlmService();
    this.embeddingsService = new EmbeddingsService();
  }

  async ask(userUid: string, question: string): Promise<string> {
    try {
      const questionEmbedding = await this.embeddingsService.generateEmbedding(
        question
      );

      const relevantRecipes = await this.retrieveRelevantRecipes(
        userUid,
        questionEmbedding
      );

      const userIngredients = await this.getUserIngredients(userUid);

      const context = this.buildRAGContext(
        relevantRecipes,
        userIngredients,
        question
      );

      console.log("RAG Context:", context);

      const systemPrompt = `You are Sulten's cooking assistant. Answer the user's question based ONLY on the recipe context provided below. Be helpful, friendly, and specific. If the user asks about recipes or ingredients they don't have, politely let them know.

${context}`;

      const response = await this.llmService.chat(systemPrompt, question, []);
      return response;
    } catch (error) {
      console.error("Error in RAG pipeline:", error);
      throw new Error(`Failed to process question: ${error}`);
    }
  }

  private async retrieveRelevantRecipes(
    userUid: string,
    questionEmbedding: number[]
  ): Promise<any[]> {
    const userRecipes = await AppDataSource.query(
      `
      SELECT r.id, r.name, r.ingress, r.difficulty, r.servings, r."prepTime", r."cookTime", r.embedding,
             'own' as recipe_type
      FROM recipe r
      WHERE r."userUid" = $1 
        AND r."deletedAt" IS NULL
        AND r.status = 'published'
        AND r.embedding IS NOT NULL
    `,
      [userUid]
    );

    const likedRecipes = await AppDataSource.query(
      `
      SELECT r.id, r.name, r.ingress, r.difficulty, r.servings, r."prepTime", r."cookTime", r.embedding,
             'liked' as recipe_type
      FROM recipe r
      INNER JOIN user_likes_recipe ulr ON r.id = ulr."recipeId"
      WHERE ulr."userUid" = $1 
        AND r."deletedAt" IS NULL
        AND r.status = 'published'
        AND r.embedding IS NOT NULL
    `,
      [userUid]
    );

    const allRecipes = [...userRecipes, ...likedRecipes];

    const recipesWithSimilarity = allRecipes.map((recipe) => {
      if (!recipe.embedding) return { ...recipe, similarity: 0 };

      const similarity = this.embeddingsService.cosineSimilarity(
        questionEmbedding,
        recipe.embedding
      );
      return { ...recipe, similarity };
    });

    return recipesWithSimilarity
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5);
  }

  private async getUserIngredients(userUid: string): Promise<any[]> {
    return await AppDataSource.query(
      `
      SELECT i.name, usi.is_priority
      FROM user_stored_ingredient usi
      INNER JOIN ingredient i ON usi."ingredientId" = i.id
      WHERE usi."userUid" = $1
      ORDER BY usi.is_priority DESC
    `,
      [userUid]
    );
  }

  private buildRAGContext(
    relevantRecipes: any[],
    ingredients: any[],
    question: string
  ): string {
    let context = `## User Question: ${question}\n\n`;
    context += "## Relevant Recipe Context\n\n";

    if (relevantRecipes.length > 0) {
      context += "### Most Relevant Recipes:\n";
      relevantRecipes.forEach((recipe, index) => {
        const time =
          recipe.prepTime || recipe.cookTime
            ? `${(recipe.prepTime || 0) + (recipe.cookTime || 0)} min`
            : "N/A";

        context += `${index + 1}. **${recipe.name}** (${
          recipe.recipe_type
        }, similarity: ${recipe.similarity?.toFixed(3)})\n`;
        context += `   - Description: ${recipe.ingress || "No description"}\n`;
        context += `   - Difficulty: ${recipe.difficulty}, Serves: ${
          recipe.servings || "N/A"
        }, Time: ${time}\n\n`;
      });
    }

    if (ingredients.length > 0) {
      context += "### Available Ingredients:\n";
      const priorityIngredients = ingredients
        .filter((i) => i.is_priority)
        .map((i) => i.name);
      const otherIngredients = ingredients
        .filter((i) => !i.is_priority)
        .map((i) => i.name);

      if (priorityIngredients.length > 0) {
        context += `Priority: ${priorityIngredients.join(", ")}\n`;
      }
      if (otherIngredients.length > 0) {
        context += `Others: ${otherIngredients.join(", ")}\n`;
      }
      context += "\n";
    }

    if (relevantRecipes.length === 0 && ingredients.length === 0) {
      context += "No relevant recipes or ingredients found for this user.\n";
    }

    return context;
  }
}
