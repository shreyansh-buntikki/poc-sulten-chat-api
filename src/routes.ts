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

mainRouter.post("/ollama/:username/chat", UserController.chatOllama);

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

export default mainRouter;
