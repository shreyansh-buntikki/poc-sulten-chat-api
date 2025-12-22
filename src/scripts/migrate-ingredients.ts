import { AppDataSource } from "../db";
import { MilvusService } from "../services/milvus.service";

async function migrateIngredients() {
  try {
    console.log("Starting ingredients migration...");

    await AppDataSource.initialize();
    console.log("Database connected");

    const milvus = new MilvusService();

    // Get all recipe_ids from Milvus
    console.log("Fetching all recipe_ids from Milvus...");
    const recipeIds = await milvus.getAllRecipeIds(10000);

    if (recipeIds.length === 0) {
      console.log("No recipes found in Milvus");
      await AppDataSource.destroy();
      return;
    }

    console.log(`Found ${recipeIds.length} unique recipes in Milvus`);

    let updated = 0;
    let errors = 0;
    const batchSize = 50;

    console.log("Starting batch updates...");
    for (let i = 0; i < recipeIds.length; i += batchSize) {
      const batch = recipeIds.slice(i, i + batchSize);

      // Process batch in parallel
      const batchPromises = batch.map(async (recipeId: string) => {
        try {
          // Get ingredients for this recipe from database
          const ingredients = await AppDataSource.query(
            `
            SELECT DISTINCT i.name
            FROM recipe_ingredient ri
            INNER JOIN ingredient i ON ri."ingredientId" = i.id
            WHERE ri."recipeId" = $1
            ORDER BY i.name
            `,
            [recipeId]
          );

          const ingredientNames = ingredients.map(
            (ing: any) => ing.name
          ) as string[];
          console.log(ingredientNames);

          const result = await milvus.updateRecipesIngredients(
            recipeId,
            ingredientNames
          );

          const updatedCount =
            typeof result.updated === "number"
              ? result.updated
              : Number(result.updated);
          if (updatedCount > 0) {
            updated++;
            return { recipeId, success: true, count: ingredientNames.length };
          } else {
            return { recipeId, success: false, reason: "No records updated" };
          }
        } catch (error) {
          console.error(`Error processing recipe ${recipeId}:`, error);
          errors++;
          return { recipeId, success: false, error: String(error) };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      const successCount = batchResults.filter((r) => r.success).length;

      console.log(
        `Progress: ${Math.min(i + batchSize, recipeIds.length)}/${
          recipeIds.length
        } | Updated: ${updated} | Errors: ${errors}`
      );

      // Small delay to avoid overwhelming the database
      if (i + batchSize < recipeIds.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    console.log("\n Flushing Milvus collection...");
    await milvus.flush();

    console.log("\n Migration complete!");
    console.log(`Total recipes processed: ${recipeIds.length}`);
    console.log(`Successfully updated: ${updated}`);
    console.log(`Errors: ${errors}`);

    await AppDataSource.destroy();
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  }
}

migrateIngredients()
  .then(() => {
    console.log("\n✅ Ingredients migration successful");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Ingredients migration failed:", error);
    process.exit(1);
  });
