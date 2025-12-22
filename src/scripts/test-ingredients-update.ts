import { AppDataSource } from "../db";
import { MilvusService } from "../services/milvus.service";

async function testIngredientsUpdate() {
  try {
    await AppDataSource.initialize();
    console.log("Database connected");

    const milvus = new MilvusService();

    // Get a test recipe ID
    const testRecipeId = "f3b5dc62-df3e-428c-82d2-089e92f723bb";

    console.log(`\n🧪 Testing update for recipe: ${testRecipeId}`);

    // Get ingredients from database
    const ingredients = await AppDataSource.query(
      `
      SELECT DISTINCT i.name
      FROM recipe_ingredient ri
      INNER JOIN ingredient i ON ri."ingredientId" = i.id
      WHERE ri."recipeId" = $1
      ORDER BY i.name
      `,
      [testRecipeId]
    );

    const ingredientNames = ingredients.map((ing: any) => ing.name) as string[];
    console.log(`Database ingredients:`, ingredientNames);

    // Check current state in Milvus
    console.log("\n📊 Current state in Milvus:");
    const beforeUpdate = await milvus.queryRecipeWithIngredients(testRecipeId);
    console.log("Before update:", JSON.stringify(beforeUpdate, null, 2));

    // Try to update
    console.log("\n🔄 Attempting update...");
    try {
      const result = await milvus.updateRecipesIngredients(
        testRecipeId,
        ingredientNames
      );
      console.log("Update result:", result);
    } catch (error) {
      console.error("Update failed with error:", error);
      throw error;
    }

    // Wait a bit for Milvus to process
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Flush to ensure data is persisted
    await milvus.flush();
    console.log("Flushed collection");

    // Check after update
    console.log("\n📊 State after update:");
    const afterUpdate = await milvus.queryRecipeWithIngredients(testRecipeId);
    console.log("After update:", JSON.stringify(afterUpdate, null, 2));

    // Check the schema to see field definition
    console.log("\n📋 Checking schema...");
    const schema = await milvus.describeCollection();
    const ingredientsField = schema.schema.fields.find(
      (f: any) => f.name === "ingredients"
    );
    console.log(
      "Ingredients field definition:",
      JSON.stringify(ingredientsField, null, 2)
    );

    await AppDataSource.destroy();
  } catch (error) {
    console.error("Test failed:", error);
    throw error;
  }
}

testIngredientsUpdate()
  .then(() => {
    console.log("\n✅ Test complete");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  });
