import "reflect-metadata";
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import { AppDataSource } from "./db";
import mainRouter from "./routes";
import { MilvusService } from "./services/milvus.service";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim())
  : true; // allow all if not specified

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

const milvusService = new MilvusService();
milvusService.createCollection();
AppDataSource.initialize()
  .then(() => {
    console.log("Database connected successfully");

    app.get("/", (req, res) => {
      res.status(200).json({
        message: "ok",
        now: new Date().toISOString(),
      });
    });

    app.use("/api", mainRouter);

    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
    console.log('PID', process.pid, 'listening')
  })
  .catch((error) => {
    console.error("Database connection failed:", error);
  });
