import "reflect-metadata";
import { DataSource } from "typeorm";
import dotenv from "dotenv";
import path from "path";

dotenv.config();

// Determine if we're running compiled JS or TypeScript
const isProduction =
  process.env.NODE_ENV === "production" || __dirname.includes("dist");
const entitiesPath = isProduction
  ? path.join(__dirname, "entities/entities/*.js")
  : path.join(__dirname, "entities/entities/*.ts");

export const AppDataSource = new DataSource({
  type: "postgres",
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || "5432"),
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  synchronize: false,
  logging: process.env.NODE_ENV !== "production",
  entities: [entitiesPath],
  migrations: [],
  subscribers: [],
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
});
