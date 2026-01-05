import OpenAI from "openai";

type OllamaChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export class OllamaService {
  private baseUrl: string;
  private chatModel: string;
  private openai: OpenAI;

  constructor() {
    this.baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
    this.chatModel = process.env.OLLAMA_CHAT_MODEL || "gemma3:latest";
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async embed(text: string): Promise<number[]> {
    try {
      // Use text-embedding-3-small with dimension=768 to match existing Milvus collection
      // The collection was created with 768 dimensions, so we need to match that
      const response = await this.openai.embeddings.create({
        model: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
        input: text,
        dimensions: 768, // Match the existing Milvus collection dimension
      });
      const embedding = response.data[0].embedding;
      console.log(`[Embedding] Generated ${embedding.length}-dimensional embedding`);
      return embedding;
    } catch (error) {
      throw new Error(
        `OpenAI embeddings error: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  async chat(messages: OllamaChatMessage[]): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.chatModel, messages, stream: false }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Ollama chat error: ${res.status} ${errText}`);
    }
    const json = (await res.json()) as {
      message: { role: string; content: string };
    };
    return json.message?.content || "";
  }

  async getRecipeMetaData(recipe: {
    ingredients: { name: string; quantity: string }[];
    instructions: { instruction: string; order: number }[];
    recipeName: string;
  }): Promise<{
    macros: Record<string, number>;
    prices: {
      indianPrice: number;
      norwegianPrice: number;
      americanPrice: number;
    };
  }> {
    // Format ingredients for the prompt
    const ingredientsText = recipe.ingredients
      .map((ing) => `${ing.quantity} ${ing.name}`)
      .join(", ");

    // Format instructions for the prompt
    const instructionsText = recipe.instructions
      .sort((a, b) => a.order - b.order)
      .map((inst, idx) => `${idx + 1}. ${inst.instruction}`)
      .join("\n");

    const prompt = `You are a nutritionist and pricing expert. Analyze the following recipe and provide:
1. COMPLETE and EXHAUSTIVE nutritional information - include ALL macros, vitamins, minerals, fatty acids, amino acids, antioxidants, and any other nutritional compounds present in the recipe
2. Estimated cost to cook this recipe in three markets: Indian (INR), Norwegian (NOK), and American (USD)

Recipe Name: ${recipe.recipeName}

Ingredients:
${ingredientsText}

Instructions:
${instructionsText}

CRITICAL INSTRUCTIONS:
- You MUST automatically identify and include ALL nutritional values present in the recipe based on the ingredients
- Analyze each ingredient and determine what nutritional compounds it contains (macros, vitamins, minerals, fatty acids, amino acids, antioxidants, phytochemicals, etc.)
- Do NOT limit yourself to only the nutrients listed in the example structure below
- Automatically detect and include ANY additional nutritional compounds you identify from the ingredients
- Include ALL trace minerals, amino acids, bioactive compounds, and phytochemicals you can identify
- Use snake_case for ALL keys (e.g., omega_3, lycopene, beta_carotene, not omega3 or omega-3)
- Include values even if they are small amounts - be comprehensive and exhaustive
- Think like a nutritionist: analyze what each ingredient contributes nutritionally and include everything

Return ONLY a valid JSON object with this structure (the macros object should include ALL nutrients found, not just these examples):
{
  "macros": {
    "protein": <number in grams>,
    "carbohydrates": <number in grams>,
    "fat": <number in grams>,
    "fiber": <number in grams>,
    "sugar": <number in grams>,
    "sodium": <number in milligrams>,
    "calories": <number>,
    "vitamin_a": <number in IU or mcg>,
    "vitamin_c": <number in milligrams>,
    "calcium": <number in milligrams>,
    "iron": <number in milligrams>,
    "potassium": <number in milligrams>,
    "magnesium": <number in milligrams>,
    "phosphorus": <number in milligrams>,
    "zinc": <number in milligrams>,
    "vitamin_d": <number in IU or mcg>,
    "vitamin_e": <number in milligrams>,
    "vitamin_k": <number in micrograms>,
    "thiamin": <number in milligrams>,
    "riboflavin": <number in milligrams>,
    "niacin": <number in milligrams>,
    "vitamin_b6": <number in milligrams>,
    "folate": <number in micrograms>,
    "vitamin_b12": <number in micrograms>,
    "biotin": <number in micrograms>,
    "pantothenic_acid": <number in milligrams>,
    "cholesterol": <number in milligrams>,
    "saturated_fat": <number in grams>,
    "monounsaturated_fat": <number in grams>,
    "polyunsaturated_fat": <number in grams>,
    "trans_fat": <number in grams>
    ...automatically add ALL other nutritional compounds you identify from analyzing the ingredients
  },
  "prices": {
    "indianPrice": <number in INR>,
    "norwegianPrice": <number in NOK>,
    "americanPrice": <number in USD>
  }
}

Rules:
- Use snake_case for all macro keys (e.g., omega_3, vitamin_a, beta_carotene, lycopene)
- Automatically analyze each ingredient and identify ALL nutritional compounds it contains
- Include ALL nutritional values you can identify from the ingredients - be exhaustive and comprehensive
- Think about what each ingredient contributes: fatty acids, vitamins, minerals, antioxidants, amino acids, etc.
- If a nutrient is not present or cannot be determined, you may omit it (don't use 0 for everything)
- Prices should be realistic market estimates for the total recipe cost
- Return ONLY the JSON object, no additional text or explanation
- The macros object should be comprehensive and include every nutritional compound you can automatically identify from the ingredients`;

    const messages: OllamaChatMessage[] = [
      {
        role: "system",
        content:
          "You are a comprehensive nutritionist and pricing expert. You automatically analyze ingredients and identify ALL nutritional compounds present (macros, vitamins, minerals, fatty acids, amino acids, antioxidants, phytochemicals, etc.). You include everything you detect, not just common nutrients. Always use snake_case for all keys. Always respond with valid JSON only, no additional text.",
      },
      {
        role: "user",
        content: prompt,
      },
    ];

    const response = await this.chat(messages);

    // Extract JSON from response (handle cases where LLM adds extra text)
    let jsonStr = response.trim();

    // Try to extract JSON if wrapped in markdown code blocks
    const jsonMatch = jsonStr.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    } else {
      // Try to find JSON object boundaries
      const startIdx = jsonStr.indexOf("{");
      const endIdx = jsonStr.lastIndexOf("}");
      if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        jsonStr = jsonStr.substring(startIdx, endIdx + 1);
      }
    }

    try {
      const parsed = JSON.parse(jsonStr);

      // Validate and normalize structure
      const macros: Record<string, number> = {};
      if (parsed.macros && typeof parsed.macros === "object") {
        for (const [key, value] of Object.entries(parsed.macros)) {
          // Convert key to snake_case if needed
          const snakeKey = key
            .replace(/([A-Z])/g, "_$1")
            .toLowerCase()
            .replace(/^_/, "");
          macros[snakeKey] =
            typeof value === "number" ? value : parseFloat(String(value)) || 0;
        }
      }

      const prices = {
        indianPrice:
          typeof parsed.prices?.indianPrice === "number"
            ? parsed.prices.indianPrice
            : parseFloat(String(parsed.prices?.indianPrice || 0)),
        norwegianPrice:
          typeof parsed.prices?.norwegianPrice === "number"
            ? parsed.prices.norwegianPrice
            : parseFloat(String(parsed.prices?.norwegianPrice || 0)),
        americanPrice:
          typeof parsed.prices?.americanPrice === "number"
            ? parsed.prices.americanPrice
            : parseFloat(String(parsed.prices?.americanPrice || 0)),
      };

      return { macros, prices };
    } catch (error) {
      console.error("Error parsing recipe metadata JSON:", error);
      console.error("Response was:", response);
      throw new Error(
        `Failed to parse recipe metadata: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
