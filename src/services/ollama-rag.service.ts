import { AppDataSource } from "../db";
import { OllamaService } from "./ollama.service";
import { MilvusService } from "./milvus.service";
import { LlmService } from "./llm.service";
import { LangchainChatService } from "./langchain.service";
import { NO_RECIPES_FOUND_MESSAGE } from "../constants";

export interface RAGResult {
  similarRecipes: any[];
  context: string;
  userIngredients: any[];
  similarRecipesFromMilvus: any[];
  recipes: any[];
  timeToGenerateEmbedding: number;
  timeToQuery: number;
}

export interface AIResponseResult {
  content: string;
  completion: any;
  previousMessages: any[];
  timeToGenerateAIResponse: number;
  systemPrompt: string;
  conversationContext: string;
}

export class OllamaRAGService {
  private ollama: OllamaService;
  private milvus: MilvusService;
  private llmService: LlmService;

  constructor() {
    this.ollama = new OllamaService();
    this.milvus = new MilvusService();
    this.llmService = new LlmService();
  }

  /**
   * Build context string from recipes array (reusable for agent results)
   */
  static buildRecipeContext(recipes: any[]): string {
    let context =
      "\n## Most Relevant Recipes (Retrieved via Semantic Search):\n";

    if (recipes.length > 0) {
      recipes.forEach((r: any, idx: number) => {
        const total = (r.prepTime || 0) + (r.cookTime || 0);
        const similarityPercent = r.similarity
          ? (r.similarity * 100).toFixed(0)
          : "N/A";
        const typeLabel =
          r.recipe_type === "owned"
            ? "(Your Recipe)"
            : r.recipe_type === "liked"
            ? "(Liked)"
            : "";
        const recipeUrl = `https://sulten.app/en/recipes/${
          r.slug || "no-slug"
        }`;
        context += `${idx + 1}. Recipe Name: "${
          r.recipe_name
        }" ${typeLabel} (${similarityPercent}% match)\n`;
        context += `   URL: ${recipeUrl}\n`;
        context += `   ${r.ingress || "No description"}\n`;
        context += `   ${r.difficulty || "N/A"} difficulty | ${
          total ? total + " min" : "Time N/A"
        }\n`;

        const ingredients = Array.isArray(r.ingredients) ? r.ingredients : [];
        if (ingredients.length > 0) {
          context += `   Ingredients:\n`;
          ingredients.forEach((ing: any) => {
            const amount = ing.amount ? `${ing.amount} ` : "";
            const unit = ing.unit ? `${ing.unit} ` : "";
            context += `     - ${amount}${unit}${ing.name}\n`;
          });
        }

        const steps = Array.isArray(r.instructions) ? r.instructions : [];
        if (steps.length > 0) {
          context += `   Instructions:\n`;
          steps.forEach((s: any, si: number) => {
            if (s?.description) {
              context += `     ${si + 1}. ${s.description}\n`;
            }
          });
        }
        context += `\n`;
      });
    } else {
      context += "No recipes found matching your request.\n";
    }

    return context;
  }

  /**
   * Build a RAGResult object from an array of recipes (useful for agent results)
   */
  static buildRAGResultFromRecipes(recipes: any[]): RAGResult {
    return {
      similarRecipes: recipes,
      context: OllamaRAGService.buildRecipeContext(recipes),
      userIngredients: [],
      similarRecipesFromMilvus: [],
      recipes: recipes,
      timeToGenerateEmbedding: 0,
      timeToQuery: 0,
    };
  }

  async runRAG(message: string, userUid: string): Promise<RAGResult> {
    let timeToQuery = 0;
    let timeToGenerateEmbedding = 0;

    const questionEmbeddingStartTime = Date.now();
    const questionEmbedding = await this.ollama.embed(message);

    const similarRecipesFromMilvus = await this.milvus.searchSimilarRecipes(
      questionEmbedding,
      10
    );

    const questionEmbeddingEndTime = Date.now();
    timeToGenerateEmbedding =
      questionEmbeddingEndTime - questionEmbeddingStartTime;

    if (!questionEmbedding || questionEmbedding.length === 0) {
      throw new Error("Failed to generate question embedding");
    }

    const recipeIds = similarRecipesFromMilvus.map((r: any) => r.recipe_id);

    if (recipeIds.length === 0) {
      return {
        similarRecipes: [],
        context: "",
        userIngredients: [],
        similarRecipesFromMilvus: [],
        recipes: [],
        timeToGenerateEmbedding,
        timeToQuery: 0,
      };
    }

    const queryStartTime = Date.now();

    const recipes = await AppDataSource.query(
      `
        SELECT r.id, r.name AS recipe_name, r.slug, r.ingress, r.difficulty, 
               r.servings, r."prepTime", r."cookTime", r."userUid",
               (
                 SELECT COALESCE(
                   json_agg(json_build_object('order', rin."order", 'description', rin.description) ORDER BY rin."order"),
                   '[]'::json
                 )
                 FROM recipe_instruction rin
                 WHERE rin."recipeId" = r.id
               ) AS instructions,
               (
                 SELECT COALESCE(
                   json_agg(
                     json_build_object(
                       'name', i.name,
                       'amount', ri.amount,
                       'unit', (
                         SELECT mut2.name 
                         FROM measuring_unit_translation mut2 
                         WHERE mut2."measuringUnitId" = mu.id 
                         LIMIT 1
                       ),
                       'order', ri."order"
                     ) ORDER BY ri."order"
                   ),
                   '[]'::json
                 )
                 FROM recipe_ingredient ri
                 INNER JOIN ingredient i ON ri."ingredientId" = i.id
                 LEFT JOIN measuring_unit mu ON ri."unitId" = mu.id
                 WHERE ri."recipeId" = r.id
               ) AS ingredients,
               EXISTS (
                 SELECT 1 FROM "like" lk
                 WHERE lk."userUid" = $2
                   AND lower(trim(lk."entityType")) = 'recipe'
                   AND trim(lk."entityId") = r.id::text
               ) AS is_liked
        FROM recipe r
        WHERE r.id = ANY($1::uuid[])
          AND r.status = 'published'
          AND r."deletedAt" IS NULL
        `,
      [recipeIds, userUid]
    );

    // Map Milvus similarity scores to recipes
    const recipeMap = new Map(recipes.map((r: any) => [r.id, r]));
    const similarRecipes = similarRecipesFromMilvus
      .map((milvusResult: any) => {
        const recipe: any = recipeMap.get(milvusResult.recipe_id);
        if (!recipe) return null;

        let recipe_type = "global";
        if (recipe.userUid === userUid) {
          recipe_type = "owned";
        } else if (recipe.is_liked) {
          recipe_type = "liked";
        }

        return {
          ...recipe,
          similarity: milvusResult.similarity,
          recipe_type,
        };
      })
      .filter((r: any) => r !== null);

    console.log({
      milvusResults: similarRecipesFromMilvus.length,
      recipesFromDB: recipes.length,
      finalRecipes: similarRecipes.length,
    });

    similarRecipes.forEach((r: any, idx: number) => {
      console.log(
        `${idx + 1}. ${r.recipe_name} (${r.recipe_type}) - Similarity: ${(
          r.similarity * 100
        )?.toFixed(1)}%`
      );
    });

    const userIngredients = await AppDataSource.query(
      `
        SELECT i.name, usi.is_priority
        FROM user_stored_ingredient usi
        INNER JOIN ingredient i ON usi."ingredientId" = i.id
        WHERE usi."userUid" = $1
        ORDER BY usi.is_priority DESC
        `,
      [userUid]
    );
    const queryEndTime = Date.now();
    timeToQuery = queryEndTime - queryStartTime;
    let context = "";

    context += "\n## Most Relevant Recipes (Retrieved via Semantic Search):\n";

    if (similarRecipes.length > 0) {
      similarRecipes.forEach((r: any, idx: number) => {
        const total = (r.prepTime || 0) + (r.cookTime || 0);
        const similarityPercent = r.similarity?.toFixed(0);
        const typeLabel =
          r.recipe_type === "owned"
            ? "(Your Recipe)"
            : r.recipe_type === "liked"
            ? "(Liked)"
            : "";
        const recipeUrl = `https://sulten.app/en/recipes/${
          r.slug || "no-slug"
        }`;
        context += `${idx + 1}. Recipe Name: "${
          r.recipe_name
        }" ${typeLabel} (${similarityPercent}% match)\n`;
        context += `   URL: ${recipeUrl}\n`;
        context += `   ${r.ingress || "No description"}\n`;
        context += `   ${r.difficulty} difficulty | ${
          total ? total + " min" : "Time N/A"
        }\n`;

        const ingredients = Array.isArray(r.ingredients) ? r.ingredients : [];
        if (ingredients.length > 0) {
          context += `   Ingredients:\n`;
          ingredients.forEach((ing: any) => {
            const amount = ing.amount ? `${ing.amount} ` : "";
            const unit = ing.unit ? `${ing.unit} ` : "";
            context += `     - ${amount}${unit}${ing.name}\n`;
          });
        }

        const steps = Array.isArray(r.instructions) ? r.instructions : [];
        if (steps.length > 0) {
          context += `   Instructions:\n`;
          steps.forEach((s: any, si: number) => {
            if (s?.description) {
              context += `     ${si + 1}. ${s.description}\n`;
            }
          });
        }
        context += `\n`;
      });
    } else {
      context +=
        "No recipes found in your collection. Please add or like some recipes first.\n";
    }

    return {
      similarRecipes,
      context,
      userIngredients,
      similarRecipesFromMilvus,
      recipes,
      timeToGenerateEmbedding,
      timeToQuery,
    };
  }

  async formatAIResponse(
    message: string,
    userUid: string,
    model: string,
    ragResult: RAGResult
  ): Promise<AIResponseResult> {
    const systemPromptStartTime = Date.now();
    let timeToGenerateAIResponse = 0;

    const systemPrompt =
      ragResult.similarRecipes.length > 0
        ? `You are **Sulten**, a friendly and knowledgeable cooking assistant.
Your job is to help users with recipes, ingredients, and cooking tips based only on the recipes listed below.

### 🎯 Your Behavior
- Be warm, conversational, and concise — like talking to a home cook friend.
- Never invent new recipes. Only refer to the recipes from the "Most Relevant Recipes" list.
- When explaining, speak naturally and clearly. Avoid sounding robotic or repetitive.
- If the user seems unsure, guide them gently ("You could try…" / "A great option might be…").

### 🚫 Recipe Filtering (CRITICAL)
- ONLY recommend recipes that FULLY match the user's dietary requirements or constraints.
- If the user specifies dietary restrictions (vegan, vegetarian, gluten-free, no dairy, etc.), carefully check the recipe ingredients.
- DO NOT suggest a recipe and then say "just remove X ingredient" or "substitute Y" — if a recipe doesn't fit, simply don't include it.
- If NONE of the recipes below match the user's requirements, honestly say "I couldn't find a recipe that matches your requirements" rather than suggesting unsuitable recipes with modifications.
- Quality over quantity: it's better to recommend 1 perfect match than 5 recipes that need modifications.

### 🧾 Response Guidelines
- When the user asks for a recipe, ingredients, or how to cook something, use the **recipes below**.
- If a recipe includes step-by-step instructions, list them clearly using numbered steps.
- Prefer recipes with higher similarity scores (they match the user's query better).
- Mention why a recipe fits ("This matches your ingredients well" or "This is similar to what you liked before").

### ✨ Formatting Rules
- Use **Markdown** formatting.
- Recipe names MUST be hyperlinks. Use the EXACT URL provided for each recipe - DO NOT create your own URL.
- Format: [**Recipe Name**](EXACT_URL_FROM_RECIPE)
- Example: If recipe shows "URL: https://sulten.app/en/recipes/thaiwrap", link as [**Thaiwrap**](https://sulten.app/en/recipes/thaiwrap)
- NEVER modify or slugify the URL yourself - copy it exactly as provided.
- Use bullet points (–) for lists and numbered steps (1. 2. 3.) for instructions.
- Use > for short cooking tips or notes.
- Do not include serving counts or irrelevant metadata.

### 📚 Most Relevant Recipes
${ragResult.context}

💡 Always choose responses from the recipes above. Do not create or name any new recipe yourself.`
        : NO_RECIPES_FOUND_MESSAGE + "${message}";

    const lc = new LangchainChatService();
    const conversationHistory = await lc.getPreviousMessages(userUid);

    let conversationContext = "";
    if (conversationHistory.length > 0) {
      conversationContext = "\n\n## Previous Conversation:\n";
      conversationHistory.slice(-6).forEach((msg: any) => {
        const role = msg._getType() === "human" ? "User" : "Assistant";
        const content =
          typeof msg.content === "string" ? msg.content : String(msg.content);
        conversationContext += `${role}: ${content}\n`;
      });
    }

    let content = "";
    let completion;

    if (model === "groq") {
      console.log("Using Groq");

      completion = await this.llmService.chatGroq(
        systemPrompt,
        message,
        conversationHistory
      );
      content = completion.choices?.[0]?.message?.content ?? "";
    } else if (model === "gemini") {
      content = await this.llmService.chat(
        systemPrompt,
        message,
        conversationHistory
      );
    }
    const systemPromptEndTime = Date.now();
    timeToGenerateAIResponse = systemPromptEndTime - systemPromptStartTime;

    const memory = lc.getMemoryFor(userUid);
    await memory.saveContext({ input: message }, { output: content });

    const previousMessages = await lc.getPreviousMessages(userUid);

    return {
      content,
      completion,
      previousMessages,
      timeToGenerateAIResponse,
      systemPrompt,
      conversationContext,
    };
  }
}
