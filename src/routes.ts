import { Router } from "express";
import { UserController } from "./controller.ts/user.controller";
import { AppDataSource } from "./db";

const mainRouter = Router();

// Health check endpoint
mainRouter.get("/health", async (req, res) => {
  const health = {
    status: "ok",
    timestamp: new Date().toISOString(),
    server: "running",
    database: "unknown",
  };

  try {
    // Check database connection
    if (AppDataSource.isInitialized) {
      await AppDataSource.query("SELECT 1");
      health.database = "connected";
    } else {
      health.database = "not initialized";
      health.status = "degraded";
    }
  } catch (error) {
    health.database = "disconnected";
    health.status = "unhealthy";
    return res.status(503).json({
      ...health,
      error:
        error instanceof Error ? error.message : "Database connection failed",
    });
  }

  res.status(200).json(health);
});

mainRouter.get("/user/search", UserController.search);

mainRouter.get("/generate/vector", UserController.generateVector);

mainRouter.post("/user/:username/chat", UserController.chat);

mainRouter.get("/user/:username", UserController.getUserResponse);

mainRouter.post(
  "/user/:username/generate-embeddings",
  UserController.generateEmbeddings
);

// Ollama (local) endpoints
mainRouter.post(
  "/ollama/:username/generate-embeddings",
  UserController.generateEmbeddingsOllama
);

mainRouter.post("/ollama/:username/chat", UserController.chatAI);

// Chat history endpoint
mainRouter.get("/ollama/:username/history", UserController.getChatHistory);

mainRouter.post(
  "/user/:username/ollama/generate-embeddings",
  UserController.generateEmbeddingsOllama
);

mainRouter.post(
  "/ollama/genreate-embeddings/all",
  UserController.generateEmbeddingsOllamaAll
);

mainRouter.post("/vapi/get-recipes/:userId", UserController.getRecipes);

// Agent-based recipe search endpoint (OpenAI)
mainRouter.post("/openai/agent/search/:userId", UserController.searchWithAgent);

// Agent-based recipe search endpoint (Groq)
mainRouter.post(
  "/groq/agent/search/:userId",
  UserController.searchWithGroqAgent
);

mainRouter.post("/ollama/recipes/meta", UserController.generateRecipesMeta);

export default mainRouter;
