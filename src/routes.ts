import { Router } from "express";
import { UserController } from "./controller.ts/user.controller";

const mainRouter = Router();

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

export default mainRouter;
