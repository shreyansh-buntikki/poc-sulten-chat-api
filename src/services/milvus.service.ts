import { DataType, MilvusClient } from "@zilliz/milvus2-sdk-node";

export class MilvusService {
  private client: MilvusClient;
  private collectionName = "sulten_embeddings";
  private dimension = 768;
  constructor() {
    this.client = new MilvusClient({
      address: process.env.MILVUS_EP || "localhost:19530",
      token: process.env.MILVUS_TOKEN,
    });
  }
  async createCollection() {
    try {
      const hasCollection = await this.client.hasCollection({
        collection_name: this.collectionName,
      });

      if (hasCollection.value) {
        console.log(`Collection ${this.collectionName} already exists`);
        return;
      }

      await this.client.createCollection({
        collection_name: this.collectionName,
        fields: [
          {
            name: "id",
            description: "Auto-generated primary key",
            data_type: DataType.Int64,
            is_primary_key: true,
            autoID: true,
          },
          {
            name: "recipe_id",
            description: "UUID of the recipe from PostgreSQL",
            data_type: DataType.VarChar,
            max_length: 36,
          },
          {
            name: "embedding",
            description: "Recipe embedding vector",
            data_type: DataType.FloatVector,
            dim: this.dimension,
          },
        ],
      });

      await this.client.createIndex({
        collection_name: this.collectionName,
        field_name: "embedding",
        index_type: "HNSW",
        metric_type: "COSINE",
        params: {
          M: 16,
          efConstruction: 256,
        },
      });

      await this.client.loadCollection({
        collection_name: this.collectionName,
      });

      console.log(`Collection ${this.collectionName} created successfully`);
    } catch (error) {
      console.error("Error creating Milvus collection:", error);
      throw error;
    }
  }

  async insertEmbeddings(
    data: Array<{ recipe_id: string; embedding: number[] }>
  ) {
    try {
      const result = await this.client.insert({
        collection_name: this.collectionName,
        data: data, // Already in correct format: [{recipe_id: "...", embedding: [...]}, ...]
      });

      console.log(`Inserted ${result.insert_cnt} embeddings`);
      return result;
    } catch (error) {
      console.error("Error inserting embeddings:", error);
      throw error;
    }
  }

  async getStats() {
    try {
      const stats = await this.client.getCollectionStatistics({
        collection_name: this.collectionName,
      });
      return stats;
    } catch (error) {
      console.error("Error getting collection stats:", error);
      throw error;
    }
  }
  async dropCollection() {
    try {
      const hasCollection = await this.client.hasCollection({
        collection_name: this.collectionName,
      });

      if (hasCollection.value) {
        await this.client.dropCollection({
          collection_name: this.collectionName,
        });
        console.log(`Collection ${this.collectionName} dropped`);
      }
    } catch (error) {
      console.error("Error dropping collection:", error);
      throw error;
    }
  }

  async flush() {
    try {
      await this.client.flush({
        collection_names: [this.collectionName],
      });
      console.log("✅ Collection flushed - data persisted to disk");
    } catch (error) {
      console.error("Error flushing collection:", error);
      throw error;
    }
  }
  async searchSimilarRecipes(
    queryEmbedding: number[],
    limit: number = 10,
    filter?: string
  ) {
    try {
      const searchParams = {
        collection_name: this.collectionName,
        data: [queryEmbedding], 
        limit: limit,
        output_fields: ["recipe_id"], 
        params: {
          nprobe: 10,
          ef: 100,
        },
      };

      const results = await this.client.search(searchParams);

      return results.results.map((result: any) => ({
        recipe_id: result.recipe_id,
        distance: result.distance,
        similarity: result.score * 100,
        result, // Convert distance to similarity for COSINE
      }));
    } catch (error) {
      console.error("Error searching similar recipes:", error);
      throw error;
    }
  }
}
