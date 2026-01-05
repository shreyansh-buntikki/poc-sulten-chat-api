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
   * Limits to top 6 recipes to avoid context overload while keeping ingredients/instructions
   */
  static buildRecipeContext(recipes: any[]): string {
    if (recipes.length === 0) {
      return "No recipes found matching your request.\n";
    }

    // Limit to top 6 recipes to optimize context size
    const limitedRecipes = recipes.slice(0, 6);
    let context = "";

    limitedRecipes.forEach((r: any, idx: number) => {
      const total = (r.prepTime || 0) + (r.cookTime || 0);
      const recipeUrl = `https://sulten.app/en/recipes/${r.slug || "no-slug"}`;
      
      context += `${idx + 1}. **${r.recipe_name}**\n`;
      context += `   URL: ${recipeUrl}\n`;
      if (r.ingress) {
        context += `   ${r.ingress}\n`;
      }
      context += `   ${r.difficulty || "N/A"} | ${total ? total + " min" : "N/A"}\n`;

      // Include ingredients (essential for answering questions)
      const ingredients = Array.isArray(r.ingredients) ? r.ingredients : [];
      if (ingredients.length > 0) {
        context += `   Ingredients: `;
        const ingredientList = ingredients
          .map((ing: any) => {
            const amount = ing.amount ? `${ing.amount} ` : "";
            const unit = ing.unit ? `${ing.unit} ` : "";
            return `${amount}${unit}${ing.name}`.trim();
          })
          .join(", ");
        context += `${ingredientList}\n`;
      }

      // Include instructions (essential for answering questions)
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

    return context;
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

    console.log("ragResult Recipes", ragResult.similarRecipes.length);

    const systemPrompt =
      ragResult.similarRecipes.length > 0
        ? `You are **Sulten**, a friendly cooking assistant. The user asked: "${message}"

**🚫 CRITICAL: DO NOT SHOW INGREDIENTS/INSTRUCTIONS IN INITIAL RECOMMENDATIONS**
- If the user is asking for recipe suggestions (e.g., "suggest me X", "give me recipes", "what can I cook"), show ONLY:
  - Recipe name (as hyperlink)
  - Description (ingress)
  - Difficulty and time
- DO NOT include ingredients or instructions in the initial response
- DO NOT list ingredients or instructions even though they are available in the recipe data below
- Ingredients/instructions are stored below for when user explicitly asks - DO NOT show them proactively

**CRITICAL RULES:**
1. **ABSOLUTE TRUST**: The recipes below were pre-filtered by our system to match the user's query. If the user asks for "Italian recipes" and recipes are listed, they ARE Italian - even if the names don't sound Italian. Present them as matching the user's request.
2. **NEVER say "I don't have X recipes"**: When recipes are provided below, they match the user's query. Say "Here are some [cuisine/type] recipes" or "Here are recipes that match your request" - never say you don't have them.
3. **Always recommend**: ALWAYS recommend 3-4 recipes from the list below (or all if fewer than 3). Present them confidently as matching what the user asked for.
4. **Dietary restrictions only**: Only apply strict filtering for explicit dietary restrictions (vegan, vegetarian, gluten-free, no dairy). Check ingredients carefully for these.

**EXACT DATA RULES (When user asks about ingredients/instructions):**
5. **When user explicitly asks about ingredients or instructions**: You MUST use the EXACT ingredients and instructions listed below for the specific recipe they're asking about. Copy them word-for-word. Do NOT paraphrase, summarize, or modify them.
6. **Understanding references**: If the user says "the first one", "the second one", "the last one", or mentions a recipe by name, use the conversation context to determine which recipe they mean. The recipes below are listed in the order they were previously mentioned.
7. **When listing ingredients**: Use the EXACT format from the recipe (amounts, units, names) - copy them exactly as shown.
8. **When listing instructions**: Use the EXACT step-by-step instructions from the recipe - copy them exactly as shown, including all details.
9. **If a recipe doesn't have ingredients/instructions listed below**: Say "I don't have the complete ingredients or instructions for [recipe name] in my current context. Please open the recipe link for full details." Do NOT invent or guess.
10. **Never modify recipe data**: Never add, remove, or change any ingredient amounts, units, names, or instruction steps. Use ONLY what is provided below.

**FORMATTING:**
- Recipe names as hyperlinks: [**Recipe Name**](EXACT_URL_FROM_RECIPE)
- Initial recommendations: Recipe name, description, difficulty, time - NO ingredients/instructions
- When user asks for ingredients/instructions: Use the exact format from the recipe (e.g., "2 cups flour, 1 tsp salt")
- When listing instructions: Use numbered steps exactly as shown in the recipe
- Be conversational and helpful, but NEVER change the recipe data

**RECIPES (These match the user's query - ingredients/instructions are available below but only show them when user asks):**
${ragResult.context}`
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
    } else if (
      model === "openai" ||
      model === "gpt-4" ||
      model === "gpt-4o-mini"
    ) {
      completion = await this.llmService.chatOpenAI(
        systemPrompt,
        message,
        conversationHistory
      );
      content = completion.choices?.[0]?.message?.content ?? "";
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
