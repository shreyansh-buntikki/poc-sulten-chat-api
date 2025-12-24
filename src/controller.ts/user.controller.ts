import { Request, Response } from "express";
import { UserService } from "../services/user.service";
import { RecipeSearchService } from "../services/recipe-search.service";
import { EmbeddingGenerationService } from "../services/embedding-generation.service";
import { ChatService } from "../services/chat.service";
import { VectorService } from "../services/vector.service";

export class UserController {
  static async search(req: Request, res: Response) {
    try {
      const { user } = req.query;
      const users = await UserService.searchUsers(user as string);
      res.status(200).json({
        message: "User searched successfully",
        users,
      });
    } catch (error: any) {
      if (error.message === "User not found") {
        return res.status(404).json({
          message: "User not found",
        });
      }
      res.status(500).json({
        message: "Internal server error",
        error: error,
      });
    }
  }

  static async generateVector(req: Request, res: Response) {
    try {
      const result = await VectorService.generateVector();
      res.status(200).json(result);
    } catch (error) {
      res.status(500).json({
        message: "Internal server error",
        error: error,
      });
    }
  }

  static async chat(req: Request, res: Response) {
    try {
      const { username } = req.params;
      const { message } = req.body;
      const result = await ChatService.chat(username, message);
      return res.status(200).json(result);
    } catch (error: any) {
      if (error.message === "User not found") {
        return res.status(404).json({
          message: "User not found",
        });
      }
      res.status(500).json({
        message: "Internal server error",
        error: error,
      });
    }
  }

  static async getUserResponse(req: Request, res: Response) {
    try {
      const { username } = req.params;
      const result = await UserService.getUserRecipesAndLikes(username);
      return res.status(200).json({
        userRecipes: result.userRecipes,
        likedRecipes: result.likedRecipes,
        user: result.user,
      });
    } catch (error: any) {
      if (error.message === "User not found") {
        return res.status(404).json({
          message: "User not found",
        });
      }
      res.status(500).json({
        message: "Internal server error",
        error: error,
      });
    }
  }

  static async generateEmbeddings(req: Request, res: Response) {
    try {
      const { username } = req.params;
      const result = await EmbeddingGenerationService.generateEmbeddingsForUser(
        username
      );
      res.status(200).json(result);
    } catch (error: any) {
      if (error.message === "User not found") {
        return res.status(404).json({
          message: "User not found",
        });
      }
      res.status(500).json({
        message: "Internal server error",
        error: error,
      });
    }
  }

  static async generateEmbeddingsOllama(req: Request, res: Response) {
    try {
      const { username } = req.params;
      const result =
        await EmbeddingGenerationService.generateEmbeddingsOllamaForUser(
          username
        );
      return res.status(200).json(result);
    } catch (error: any) {
      if (error.message === "User not found") {
        return res.status(404).json({ message: "User not found" });
      }
      res.status(500).json({ message: "Internal server error", error });
    }
  }

  static async chatAI(req: Request, res: Response) {
    try {
      const { username } = req.params;
      const { message, model } = req.body;
      const result = await ChatService.chatAI(username, message, model);
      return res.status(200).json(result);
    } catch (error: any) {
      if (error.message === "User not found") {
        return res.status(404).json({ message: "User not found" });
      }
      console.error("Chat error:", error);
      res.status(500).json({
        message: "Internal server error",
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  static async generateEmbeddingsOllamaAll(req: Request, res: Response) {
    try {
      const result =
        await EmbeddingGenerationService.generateEmbeddingsOllamaAll();
      return res.status(200).json(result);
    } catch (error) {
      console.error("Embeddings generation error:", error);
      res.status(500).json({
        message: "Internal server error",
        error: error,
      });
    }
  }

  static async getChatHistory(req: Request, res: Response) {
    try {
      const { username } = req.params;
      const result = await ChatService.getChatHistory(username);
      return res.status(200).json(result);
    } catch (error: any) {
      if (error.message === "User not found") {
        return res.status(404).json({ message: "User not found" });
      }
      res.status(500).json({ message: "Internal server error", error });
    }
  }

  static async getRecipes(req: Request, res: Response) {
    try {
      console.log("call received", req.params.userId);
      const { query } = req.body;
      const { userId } = req.params;

      console.log({ query, userId });
      const result = await RecipeSearchService.getRecipes(
        query,
        userId ?? "00DLyaukerYEGpYXYF3ALnSJc0a2"
      );

      console.log(result.recipes);
      return res.status(200).json(result);
    } catch (error) {
      console.log(error);
      res.status(500).json({ message: "Internal server error", error });
    }
  }

  static async generateRecipesMeta(req: Request, res: Response) {
    try {
      const limit = Number(req.body.limit ?? 0) || 10;
      const result = await RecipeSearchService.getRecipesMeta(limit);
      return res.status(200).json(result);
    } catch (error) {
      console.error("[Controller] Error in generateRecipesMeta:", error);
      res.status(500).json({
        message: "Internal server error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  static async searchWithAgent(req: Request, res: Response) {
    try {
      const { userId } = req.params;
      const { message } = req.body;

      if (!message || typeof message !== "string") {
        return res.status(400).json({
          message: "Bad request",
          error: "Message is required in request body",
        });
      }

      if (!userId) {
        return res.status(400).json({
          message: "Bad request",
          error: "userId is required",
        });
      }

      const result = await RecipeSearchService.searchWithOpenAIAgent(
        message,
        userId
      );

      return res.status(200).json(result);
    } catch (error) {
      console.error("[Controller] Error in searchWithAgent:", error);
      res.status(500).json({
        message: "Internal server error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  static async searchWithGroqAgent(req: Request, res: Response) {
    try {
      const { userId } = req.params;
      const { message } = req.body;

      if (!message || typeof message !== "string") {
        return res.status(400).json({
          message: "Bad request",
          error: "Message is required in request body",
        });
      }

      if (!userId) {
        return res.status(400).json({
          message: "Bad request",
          error: "userId is required",
        });
      }

      const result = await RecipeSearchService.searchWithGroqAgent(
        message,
        userId
      );

      return res.status(200).json(result);
    } catch (error) {
      console.error("[Controller] Error in searchWithGroqAgent:", error);
      res.status(500).json({
        message: "Internal server error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
