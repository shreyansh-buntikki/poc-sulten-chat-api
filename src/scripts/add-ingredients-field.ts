import { AppDataSource } from "../db";
import { MilvusService } from "../services/milvus.service";

async function addIngredientsField() {
  try {
    console.log("Starting migration to add ingredients field...");

    await AppDataSource.initialize();
    console.log("Database connected");

    const milvus = new MilvusService();

    // Check if collection exists
    const hasCollection = await milvus.hasCollection();

    if (!hasCollection) {
      console.log(
        "Collection doesn't exist. Creating with ingredients field..."
      );
      await milvus.createCollection();
      console.log("Collection created with ingredients field");
      await AppDataSource.destroy();
      return;
    }

    // Check current schema
    console.log("Checking current collection schema...");
    const schema = await milvus.describeCollection();
    const fieldNames = schema.schema.fields.map((f: any) => f.name);
    console.log("Current fields:", fieldNames);

    if (fieldNames.includes("ingredients")) {
      console.log("✅ Ingredients field already exists in collection!");
      await AppDataSource.destroy();
      return;
    }

    console.log(
      "⚠️  Ingredients field not found. Need to recreate collection..."
    );
    console.log("Backing up existing data...");

    // Backup all existing data
    const allRecipes = await milvus.queryAllRecipes(100000);

    if (!allRecipes || allRecipes.length === 0) {
      console.log("No data to backup. Dropping and recreating collection...");
      await milvus.dropCollection();
      await milvus.createCollection();
      console.log("✅ Collection recreated with ingredients field");
      await AppDataSource.destroy();
      return;
    }

    const backupData = allRecipes.map((record: any) => ({
      recipe_id: record.recipe_id,
      embedding: record.embedding,
    }));

    console.log(`Backed up ${backupData.length} records`);

    // Drop and recreate collection with ingredients field
    console.log("Dropping existing collection...");
    await milvus.dropCollection();

    console.log("Creating collection with ingredients field...");
    await milvus.createCollection();

    // Re-insert all data with empty ingredients arrays
    console.log("Re-inserting data with empty ingredients...");
    const batchSize = 100;
    let inserted = 0;

    for (let i = 0; i < backupData.length; i += batchSize) {
      const batch = backupData.slice(i, i + batchSize).map((record) => ({
        recipe_id: record.recipe_id,
        embedding: record.embedding,
        ingredients: [], // Empty array initially
      }));

      await milvus.insertData(batch);

      inserted += batch.length;
      console.log(`Progress: ${inserted}/${backupData.length}`);

      if (inserted % 500 === 0) {
        await milvus.flush();
      }
    }

    console.log("Flushing collection...");
    await milvus.flush();

    console.log("✅ Collection recreated with ingredients field!");
    console.log(`✅ Re-inserted ${inserted} records`);
    console.log(
      "\nNow run the ingredients migration script to populate ingredients:"
    );

    await AppDataSource.destroy();
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  }
}

addIngredientsField()
  .then(() => {
    console.log("\n✅ Migration successful");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Migration failed:", error);
    process.exit(1);
  });
