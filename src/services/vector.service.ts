import { AppDataSource } from "../db";

export class VectorService {
  /**
   * Generate vector extension and embedding column
   */
  static async generateVector() {
    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector;`);
      await queryRunner.query(
        `ALTER TABLE recipe ADD COLUMN IF NOT EXISTS embedding vector(768);`
      );
      await queryRunner.query(
        `CREATE INDEX IF NOT EXISTS recipe_embedding_idx ON recipe USING ivfflat (embedding vector_cosine_ops);`
      );
      return {
        message:
          "Vector extension enabled, embedding column added, and index created successfully.",
      };
    } finally {
      await queryRunner.release();
    }
  }
}
