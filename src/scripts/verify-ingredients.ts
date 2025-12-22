import { AppDataSource } from "../db";
import { MilvusService } from "../services/milvus.service";

async function verifyIngredients() {
  try {
    console.log("Starting ingredients verification...");

    await AppDataSource.initialize();
    console.log("Database connected");

    const milvus = new MilvusService();

    // Check collection schema
    console.log("\n📋 Checking collection schema...");
    const schema = await milvus.describeCollection();
    const fieldNames = schema.schema.fields.map((f: any) => f.name);
    console.log("Fields in collection:", fieldNames);

    if (!fieldNames.includes("ingredients")) {
      console.log("❌ Ingredients field not found in collection schema!");
      console.log("Run: npx ts-node src/scripts/add-ingredients-field.ts");
      await AppDataSource.destroy();
      return;
    }

    console.log("✅ Ingredients field exists in schema");

    // Get total recipe count
    const allRecipeIds = await milvus.getAllRecipeIds(10000);
    console.log(`\n📊 Total recipes in Milvus: ${allRecipeIds.length}`);

    // Sample verification
    const sampleSize = Math.min(20, allRecipeIds.length);
    console.log(`\n🔍 Checking sample of ${sampleSize} recipes...\n`);

    const sampleIds = allRecipeIds.slice(0, sampleSize);
    let withIngredients = 0;
    let withoutIngredients = 0;
    let nullIngredients = 0;

    for (const recipeId of sampleIds) {
      const records = await milvus.queryRecipeWithIngredients(recipeId);

      if (records.length === 0) {
        console.log(`⚠️  ${recipeId}: No records found`);
        continue;
      }

      const record = records[0];
      const ingredients = record.ingredients;

      if (ingredients === null || ingredients === undefined) {
        nullIngredients++;
        console.log(`❌ ${recipeId}: ingredients is null/undefined`);
      } else if (Array.isArray(ingredients)) {
        if (ingredients.length === 0) {
          withoutIngredients++;
          console.log(`⚠️  ${recipeId}: ingredients is empty array`);
        } else {
          withIngredients++;
          console.log(
            `✅ ${recipeId}: ${ingredients.length} ingredients - ${ingredients
              .slice(0, 3)
              .join(", ")}${ingredients.length > 3 ? "..." : ""}`
          );
        }
      } else {
        console.log(
          `⚠️  ${recipeId}: ingredients is not an array (type: ${typeof ingredients})`
        );
        console.log(`   Value:`, ingredients);
      }
    }

    console.log("\n📈 Summary:");
    console.log(`   ✅ With ingredients: ${withIngredients}/${sampleSize}`);
    console.log(`   ⚠️  Empty arrays: ${withoutIngredients}/${sampleSize}`);
    console.log(`   ❌ Null/undefined: ${nullIngredients}/${sampleSize}`);

    // Check a specific recipe from database
    if (sampleIds.length > 0) {
      const testRecipeId = sampleIds[0];
      console.log(`\n🔬 Detailed check for recipe: ${testRecipeId}`);

      // Get ingredients from database
      const dbIngredients = await AppDataSource.query(
        `
        SELECT DISTINCT i.name
        FROM recipe_ingredient ri
        INNER JOIN ingredient i ON ri."ingredientId" = i.id
        WHERE ri."recipeId" = $1
        ORDER BY i.name
        `,
        [testRecipeId]
      );

      const dbIngredientNames = dbIngredients.map((ing: any) => ing.name);
      console.log(
        `   Database ingredients (${dbIngredientNames.length}):`,
        dbIngredientNames
      );

      // Get from Milvus
      const milvusRecords = await milvus.queryRecipeWithIngredients(
        testRecipeId
      );
      if (milvusRecords.length > 0) {
        const milvusIngredients = milvusRecords[0].ingredients;
        console.log(`   Milvus ingredients:`, milvusIngredients);

        if (Array.isArray(milvusIngredients)) {
          const match =
            milvusIngredients.length === dbIngredientNames.length &&
            milvusIngredients.every(
              (ing, idx) => ing === dbIngredientNames[idx]
            );
          console.log(`   Match: ${match ? "✅" : "❌"}`);
        }
      }
    }

    await AppDataSource.destroy();
  } catch (error) {
    console.error("Verification failed:", error);
    throw error;
  }
}

verifyIngredients()
  .then(() => {
    console.log("\n✅ Verification complete");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Verification failed:", error);
    process.exit(1);
  });
