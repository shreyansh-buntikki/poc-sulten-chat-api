import { AppDataSource } from "../db";
import { MilvusService } from "../services/milvus.service";

async function migrateEmbeddings() {
  try {
    console.log("Starting migration...");

    await AppDataSource.initialize();
    console.log("Database connected");

    const milvus = new MilvusService();

    console.log("Dropping existing collection if it exists...");
    await milvus.dropCollection();

    await milvus.createCollection();
    console.log("Milvus collection ready");

    const recipes = await AppDataSource.query(`
      SELECT id, embedding
      FROM recipe
      WHERE embedding IS NOT NULL
        AND status = 'published'
        AND "deletedAt" IS NULL
    `);

    console.log(`Found ${recipes.length} recipes with embeddings`);

    if (recipes.length === 0) {
      console.log("No recipes to migrate");
      return;
    }

    const embeddings = recipes.map((recipe: any) => {
      let embedding = recipe.embedding;

      if (typeof embedding === "string") {
        embedding = embedding
          .replace(/^\[|\]$/g, "") 
          .split(",")
          .map((v: string) => parseFloat(v.trim()));
      }
      return {
        recipe_id: recipe.id,
        embedding: embedding, 
      };
    });

    const batchSize = 100;
    let inserted = 0;

    console.log("Starting batch inserts...");
    for (let i = 0; i < embeddings.length; i += batchSize) {
      const batch = embeddings.slice(i, i + batchSize);
      const result = await milvus.insertEmbeddings(batch);
      inserted += batch.length;
      
      if (inserted % 500 === 0) {
        console.log(`Flushing at ${inserted} records...`);
        await milvus.flush();
      }
      
      console.log(`Progress: ${inserted}/${embeddings.length}`);
    }

    console.log("\n Flushing all data to disk...");
    await milvus.flush();
    
    console.log("Waiting for statistics to update...");
    await new Promise(resolve => setTimeout(resolve, 3000));

    const stats = await milvus.getStats();
    console.log("\n Migration complete!");
    console.log("Collection stats:", JSON.stringify(stats, null, 2));
    
    const rowCount = stats.data?.row_count || stats.stats?.find((s: any) => s.key === 'row_count')?.value || '0';
    console.log(`\n Total rows in Milvus: ${rowCount}`);

    await AppDataSource.destroy();
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  }
}

migrateEmbeddings()
  .then(() => {
    console.log("\nMigration successful");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n Migration failed:", error);
    process.exit(1);
  });