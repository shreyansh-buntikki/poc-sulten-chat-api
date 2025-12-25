import { AppDataSource } from "../db";
import { ChatbotService } from "./chatbot.service";
import { LangchainChatService } from "./langchain.service";
import { LlmService } from "./llm.service";
import { OllamaRAGService } from "./ollama-rag.service";
import { NO_RECIPES_FOUND_MESSAGE } from "../constants";

export class ChatService {
  /**
   * Basic chat using ChatbotService
   */
  static async chat(username: string, message: string) {
    const user = await AppDataSource.query(
      `SELECT uid FROM "user" WHERE username = $1`,
      [username]
    );
    if (!user || user.length === 0) {
      throw new Error("User not found");
    }
    const userId = user[0].uid;
    const chatbotService = new ChatbotService();
    const aiResponse = await chatbotService.ask(userId, message);

    return {
      user: username,
      question: message,
      response: aiResponse,
    };
  }

  /**
   * AI chat with RAG
   */
  static async chatAI(username: string, message: string, model: string) {
    const llmService = new LlmService();
    let timeToCheckTopic = 0;

    const user = await AppDataSource.query(
      `SELECT uid FROM "user" WHERE username = $1`,
      [username]
    );
    if (!user || user.length === 0) {
      throw new Error("User not found");
    }
    const userUid = user[0].uid;
    const lc = new LangchainChatService();
    const history = await lc.getPreviousMessages(userUid);
    const lastAIMessage = history
      .filter((m: any) => m._getType() === "ai")
      .slice(-1)[0];

    const lastAIContent = lastAIMessage
      ? typeof lastAIMessage.content === "string"
        ? lastAIMessage.content
        : String(lastAIMessage.content)
      : null;

    const topicCheckStartTime = Date.now();
    const topicCheckPrompt = lastAIContent
      ? `You are checking if a conversation is about food/recipes/cooking.
    
    Previous assistant message: "${lastAIContent}"
    User's reply: "${message}"
    
    Is this conversation about food, recipes, cooking, ingredients, or meal planning?
    Reply only with "YES" if it is food-related or a continuation of the food conversation.
    Otherwise reply only with "NO".
    
    Answer (YES or NO):`
      : `Decide if the user message is about food, recipes, cooking, ingredients, or meal planning.
    Reply only with "YES" if it is food-related.
    Otherwise, reply only with "NO".
    
    Answer (YES or NO):
    User message: "${message}"
    `;
    const ragService = new OllamaRAGService();
    const ragResult = await ragService.runRAG(message, userUid);

    if (ragResult.similarRecipesFromMilvus.length === 0) {
      const response = await llmService.chat(
        "",
        "${message}",
        []
      );
      return {
        response: response,
        debug: {
          message: "No recipes found in Milvus",
          recipeIds: [],
        },
      };
    }

    const aiResponseResult = await ragService.formatAIResponse(
      message,
      userUid,
      model,
      ragResult
    );

    return {
      response: aiResponseResult.content,
      previousMessages: aiResponseResult.previousMessages,
      debug: {
        model,
        completion: aiResponseResult.completion,
        question: message,
        context: ragResult.context,
        conversationContext: aiResponseResult.conversationContext,
        embeddingGenerated: true,
        userIngredients: ragResult.userIngredients,
        calculationMethod: "Milvus Vector Search + PostgreSQL Details",
        milvusResults: ragResult.similarRecipesFromMilvus.length,
        recipesFromDB: ragResult.recipes.length,
        systemPrompt: aiResponseResult.systemPrompt,
        time: {
          timeToCheckTopic: timeToCheckTopic / 1000,
          timeToGenerateEmbedding: ragResult.timeToGenerateEmbedding / 1000,
          timeToQuery: ragResult.timeToQuery / 1000,
          timeToGenerateAIResponse:
            aiResponseResult.timeToGenerateAIResponse / 1000,
        },
        relevantRecipesFound: ragResult.similarRecipes.length,
        topRelevantRecipes: ragResult.similarRecipes.map((r: any) => ({
          name: r.recipe_name,
          type: r.recipe_type,
          similarity: `${r.similarity?.toFixed(1)}%`,
        })),
        similarRecipesFromMilvus: ragResult.similarRecipesFromMilvus,
      },
    };
  }

  /**
   * Get chat history for a user
   */
  static async getChatHistory(username: string) {
    const user = await AppDataSource.query(
      `SELECT uid FROM "user" WHERE username = $1`,
      [username]
    );
    if (!user || user.length === 0) {
      throw new Error("User not found");
    }
    const userUid = user[0].uid;

    const lc = new LangchainChatService();
    const previousMessages = await lc.getPreviousMessages(userUid);

    return {
      username,
      userUid,
      previousMessages,
    };
  }
}
