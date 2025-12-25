import "reflect-metadata";
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import { AppDataSource } from "./db";
import mainRouter from "./routes";
import { MilvusService } from "./services/milvus.service";

dotenv.config();

const devAllowAll = true;

const app = express();
const PORT = process.env.PORT || 3000;
const allowedOriginsEnv = process.env.CORS_ORIGIN;

let allowedOrigins: string[] | null = null;
if (allowedOriginsEnv) {
  allowedOrigins = allowedOriginsEnv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
const corsOptions = {
  origin: (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void
  ) => {
    if (!origin) return callback(null, true);

    if (devAllowAll) return callback(null, true);

    if (!allowedOrigins) return callback(null, true);

    if (allowedOrigins.indexOf(origin) !== -1) return callback(null, true);

    return callback(new Error("CORS policy: origin not allowed"), false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Accept",
    "Accept-Language",
    "Origin",
    "Referer",
    "User-Agent",
    "ngrok-skip-browser-warning",
    "x-vapi-signature",
    "x-requested-with",
  ],
  exposedHeaders: ["Content-Length", "X-Kuma-Revision"],
  optionsSuccessStatus: 204,
};
app.use((req, res, next) => {
  cors(corsOptions)(req, res, (err?: Error) => {
    if (err) {
      console.warn(
        "CORS blocked:",
        err.message,
        "origin:",
        req.header("Origin")
      );
      res.status(403).json({ error: "CORS blocked: origin not allowed" });
      return;
    }
    next();
  });
});

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
    console.log("PID", process.pid, "listening");
  })
  .catch((error) => {
    console.error("Database connection failed:", error);
  });
