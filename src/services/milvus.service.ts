import { DataType, MilvusClient } from "@zilliz/milvus2-sdk-node";

export type SimpleIntent = {
  required_ingredients?: string[];
  excluded_ingredients?: string[];
};
export class MilvusService {
  private client: MilvusClient;
  private collectionName = "sulten_embeddings";
  // Milvus collection uses 768-dimensional embeddings
  private dimension = 768;

  getCollectionName(): string {
    return this.collectionName;
  }

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
          {
            name: "ingredients",
            description: "Array of ingredient names",
            data_type: DataType.Array,
            element_type: DataType.VarChar,
            max_length: 200,
            max_capacity: 100,
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

  async buildMilvusFilter(intent: SimpleIntent) {
    const parts: string[] = [];

    for (const ing of intent.excluded_ingredients || []) {
      parts.push(`ingredients not_contains "${ing.toLowerCase()}"`);
    }

    for (const ing of intent.required_ingredients || []) {
      parts.push(`ingredients contains "${ing.toLowerCase()}"`);
    }

    return parts.length ? parts.join(" and ") : "";
  }

  async insertEmbeddings(
    data: Array<{ recipe_id: string; embedding: number[] }>
  ) {
    try {
      const result = await this.client.insert({
        collection_name: this.collectionName,
        data: data,
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
    intent?: SimpleIntent
  ) {
    try {
      const hasCollection = await this.client.hasCollection({
        collection_name: this.collectionName,
      });

      if (!hasCollection.value) {
        console.error(`[MILVUS] Collection "${this.collectionName}" does not exist`);
        return [];
      }

      // Check collection stats to see if it has data
      try {
        const stats = await this.client.getCollectionStatistics({
          collection_name: this.collectionName,
        });
        // StatisticsResponse structure may vary - access row_count safely
        const rowCount = (stats as any).row_count || (stats as any).stats?.row_count || 0;
        console.log(`[MILVUS] Collection "${this.collectionName}" has ${rowCount} rows`);
        if (rowCount === 0) {
          console.error(`[MILVUS] Collection "${this.collectionName}" is empty - no recipes indexed`);
          return [];
        }
      } catch (statsError) {
        console.warn(`[MILVUS] Could not get collection stats:`, statsError);
        // Continue anyway - collection might still work
      }

      // Ensure collection is loaded
      try {
        await this.client.loadCollection({
          collection_name: this.collectionName,
        });
        console.log(`[MILVUS] Collection "${this.collectionName}" loaded`);
      } catch (loadError: any) {
        // It's okay if already loaded, but log other errors
        if (loadError?.message && !loadError.message.includes("already loaded")) {
          console.warn(`[MILVUS] Error loading collection:`, loadError.message);
        }
      }

      let filterExpr: string | undefined;

      if (intent) {
        filterExpr = await this.buildMilvusFilter(intent);
        console.log(`[MILVUS] Using filter expression: ${filterExpr}`);
      }

      // Validate embedding dimension
      if (!queryEmbedding || queryEmbedding.length !== this.dimension) {
        console.error(
          `[MILVUS] Invalid embedding dimension: expected ${this.dimension}, got ${queryEmbedding?.length || 0}`
        );
        return [];
      }

      const searchParams = {
        collection_name: this.collectionName,
        data: [queryEmbedding],
        limit,
        topk: limit,
        output_fields: ["recipe_id"],
        anns_field: "embedding",
        metric_type: "COSINE",
        params: {
          nprobe: 10,
          ef: 100,
        },
        filter: filterExpr || undefined,
      };

      console.log(`[MILVUS] Searching with limit: ${limit}, filter: ${filterExpr || "none"}`);
      const res = await this.client.search(searchParams);
      const hits = res.results ?? [];
      console.log(`[MILVUS] Search returned ${hits.length} hits`);

      if (hits.length === 0 && res.results) {
        console.warn(`[MILVUS] Search returned empty results array. Full response:`, JSON.stringify(res, null, 2));
      }

      return hits.map((hit: any) => ({
        recipe_id: hit.recipe_id,
        distance: hit.distance,
        similarity: hit.score ?? 1 - (hit.distance ?? 0),
        raw: hit,
      }));
    } catch (error) {
      console.error("[MILVUS] Error searching:", error);
      if (error instanceof Error) {
        console.error("[MILVUS] Error details:", error.message, error.stack);
      }
      throw error;
    }
  }

  async updateRecipesIngredients(recipeId: string, ingredients: string[]) {
    try {
      const hasCollection = await this.client.hasCollection({
        collection_name: this.collectionName,
      });

      if (!hasCollection.value) {
        await this.createCollection();
      }

      // Query to get existing records (we need the embedding)
      const queryResult = await this.client.query({
        collection_name: this.collectionName,
        expr: `recipe_id == "${recipeId}"`,
        output_fields: ["recipe_id", "embedding", "ingredients"],
      });

      if (!queryResult.data || queryResult.data.length === 0) {
        console.log(`No records found for recipe_id: ${recipeId}`);
        return { updated: 0, message: "No records found" };
      }

      // Ensure ingredients is an array (not null/undefined)
      const ingredientsArray = Array.isArray(ingredients) ? ingredients : [];

      // Get the first record's embedding (they should all have the same embedding)
      const firstRecord = queryResult.data[0];
      const embedding = firstRecord.embedding;

      if (!embedding) {
        console.error(`No embedding found for recipe_id: ${recipeId}`);
        return { updated: 0, message: "No embedding found" };
      }

      // Delete all existing records for this recipe_id
      console.log(
        `Deleting ${queryResult.data.length} existing record(s) for recipe_id: ${recipeId}`
      );
      const deleteResult = await this.client.delete({
        collection_name: this.collectionName,
        filter: `recipe_id == "${recipeId}"`,
      });

      console.log(`Deleted ${deleteResult.delete_cnt} record(s)`);

      // Insert a single new record with updated ingredients
      console.log(
        `Inserting updated record for recipe ${recipeId} with ${ingredientsArray.length} ingredients:`,
        ingredientsArray.slice(0, 3)
      );

      const insertResult = await this.client.insert({
        collection_name: this.collectionName,
        data: [
          {
            recipe_id: recipeId,
            embedding: embedding,
            ingredients: ingredientsArray,
          },
        ],
      });

      console.log(`Inserted ${insertResult.insert_cnt} record(s)`);

      return {
        updated: insertResult.insert_cnt,
        deleted: deleteResult.delete_cnt,
        message: "Ingredients updated successfully",
      };
    } catch (e) {
      console.error(`Error updating recipes ingredients for ${recipeId}:`, e);
      console.error("Ingredients that failed:", ingredients);
      throw e;
    }
  }

  async getAllRecipeIds(limit: number = 10000): Promise<string[]> {
    try {
      const queryResult = await this.client.query({
        collection_name: this.collectionName,
        expr: "recipe_id != ''", // Query all records
        output_fields: ["recipe_id"],
        limit: limit,
      });

      if (!queryResult.data || queryResult.data.length === 0) {
        return [];
      }

      // Return unique recipe_ids
      return [
        ...new Set(queryResult.data.map((record: any) => record.recipe_id)),
      ];
    } catch (error) {
      console.error("Error getting all recipe IDs:", error);
      throw error;
    }
  }

  async describeCollection() {
    try {
      const schema = await this.client.describeCollection({
        collection_name: this.collectionName,
      });
      return schema;
    } catch (error) {
      console.error("Error describing collection:", error);
      throw error;
    }
  }

  async hasCollection(): Promise<boolean> {
    try {
      const result = await this.client.hasCollection({
        collection_name: this.collectionName,
      });
      return !!result.value;
    } catch (error) {
      console.error("Error checking collection:", error);
      throw error;
    }
  }

  async queryAllRecipes(limit: number = 100000) {
    try {
      const queryResult = await this.client.query({
        collection_name: this.collectionName,
        expr: "recipe_id != ''",
        output_fields: ["recipe_id", "embedding"],
        limit: limit,
      });
      return queryResult.data || [];
    } catch (error) {
      console.error("Error querying all recipes:", error);
      throw error;
    }
  }

  async insertData(data: any[]) {
    try {
      const result = await this.client.insert({
        collection_name: this.collectionName,
        data: data,
      });
      return result;
    } catch (error) {
      console.error("Error inserting data:", error);
      throw error;
    }
  }

  async queryRecipeWithIngredients(recipeId: string) {
    try {
      const queryResult = await this.client.query({
        collection_name: this.collectionName,
        expr: `recipe_id == "${recipeId}"`,
        output_fields: ["recipe_id", "ingredients"],
        limit: 10,
      });
      return queryResult.data || [];
    } catch (error) {
      console.error("Error querying recipe with ingredients:", error);
      throw error;
    }
  }

  async verifyIngredients(sampleSize: number = 10) {
    try {
      const recipeIds = await this.getAllRecipeIds(sampleSize);
      const results = [];

      for (const recipeId of recipeIds) {
        const records = await this.queryRecipeWithIngredients(recipeId);
        if (records.length > 0) {
          const record = records[0];
          const hasIngredients =
            record.ingredients &&
            Array.isArray(record.ingredients) &&
            record.ingredients.length > 0;

          results.push({
            recipe_id: recipeId,
            has_ingredients: hasIngredients,
            ingredients_count: hasIngredients ? record.ingredients.length : 0,
            ingredients: record.ingredients || null,
          });
        }
      }

      return results;
    } catch (error) {
      console.error("Error verifying ingredients:", error);
      throw error;
    }
  }
}
