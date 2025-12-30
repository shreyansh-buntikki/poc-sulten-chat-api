import { GoogleGenerativeAI } from "@google/generative-ai";
import { Groq } from "groq-sdk";
import OpenAI from "openai";
import axios from "axios";
import { SimpleIntent } from "./milvus.service";

export class LlmService {
  private genAI: GoogleGenerativeAI;
  private chatModel: any;
  private groq: Groq;
  private openai: OpenAI;

  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.AI_KEY!);
    const modelName = process.env.GEMINI_MODEL || "gemini-1.5-pro";
    this.chatModel = this.genAI.getGenerativeModel({
      model: modelName,
    });
    this.groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async chat(
    systemPrompt: string,
    userMessage: string,
    conversationHistory: any[] = []
  ): Promise<string> {
    const contents = [];

    if (conversationHistory && conversationHistory.length > 0) {
      for (const msg of conversationHistory) {
        const role = msg._getType() === "human" ? "user" : "model";
        const content =
          typeof msg.content === "string" ? msg.content : String(msg.content);
        contents.push({
          role: role,
          parts: [{ text: content }],
        });
      }
    }

    contents.push({
      role: "user",
      parts: [{ text: userMessage }],
    });

    const generateConfig: any = {
      contents: contents,
    };

    if (systemPrompt && systemPrompt.trim() !== "") {
      generateConfig.systemInstruction = systemPrompt;
    }

    const result = await this.chatModel.generateContent(generateConfig);

    return result.response.text();
  }

  async chatGroq(
    systemPrompt: string,
    userMessage: string,
    conversationHistory: any[] = []
  ) {
    const messages: any[] = [];

    if (systemPrompt && systemPrompt.trim() !== "") {
      messages.push({
        role: "system",
        content: systemPrompt,
      });
    }

    if (conversationHistory && conversationHistory.length > 0) {
      for (const msg of conversationHistory) {
        const role = msg._getType() === "human" ? "user" : "assistant";
        const content =
          typeof msg.content === "string" ? msg.content : String(msg.content);
        messages.push({
          role,
          content,
        });
      }
    }

    messages.push({
      role: "user",
      content: userMessage,
    });

    const completion = await this.groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages,
    });

    return completion;
  }

  async extractIntentGroq(userMessage: string): Promise<SimpleIntent> {
    const messages: any[] = [
      {
        role: "system",
        content: `You are an intent extractor for a recipe chatbot. Your job is to analyze the user's message and output ONLY:
  - which ingredients MUST be included (required_ingredients)
  - which ingredients MUST be excluded (excluded_ingredients)
  
  Rules:
  - Treat allergies, "no X", "without X", "don't want X" as exclusions.
  - Treat "with X", "I have X", "using X" as required ingredients.
  - Use only ingredient words, no cuisine names or adjectives.
  - Normalize all ingredient names: lowercase, no accents (crème fraîche -> creme fraiche, rødløk -> rodlok).
  - If nothing is mentioned, use empty arrays.
  - Output MUST be valid JSON with exactly these two fields.`,
      },
      {
        role: "user",
        content: userMessage,
      },
    ];

    const completion = await this.groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages,
      temperature: 0.1,
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No content in Groq response");
    }

    try {
      const parsed = JSON.parse(content);
      return {
        required_ingredients: parsed.required_ingredients || [],
        excluded_ingredients: parsed.excluded_ingredients || [],
      };
    } catch (error) {
      throw new Error(`Failed to parse JSON from Groq: ${content}`);
    }
  }

  async chatOpenAI(
    systemPrompt: string,
    userMessage: string,
    conversationHistory: any[] = []
  ) {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

    if (systemPrompt && systemPrompt.trim() !== "") {
      messages.push({
        role: "system",
        content: systemPrompt,
      });
    }

    if (conversationHistory && conversationHistory.length > 0) {
      for (const msg of conversationHistory) {
        const role = msg._getType() === "human" ? "user" : "assistant";
        const content =
          typeof msg.content === "string" ? msg.content : String(msg.content);
        messages.push({
          role: role as "user" | "assistant",
          content,
        });
      }
    }

    messages.push({
      role: "user",
      content: userMessage,
    });

    const completion = await this.openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages,
    });

    return completion;
  }

  /**
   * Get recipe metadata (macros and prices) using ChatGPT API
   */
  async getRecipeMetaData(recipe: {
    ingredients: { name: string; quantity: string; unit: string }[];
    instructions: { instruction: string; order: number }[];
    recipeName: string;
  }): Promise<{
    macros: Record<string, number>;
    prices: {
      indianPrice: number;
      norwegianPrice: number;
      americanPrice: number;
    };
    seasonality?: string[];
    tokens: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
  }> {
    // Format ingredients for the prompt
    const ingredientsText = recipe.ingredients
      .map((ing) => `${ing.quantity}${ing.unit} ${ing.name}`)
      .join(", ");

    // Format instructions for the prompt
    const instructionsText = recipe.instructions
      .sort((a, b) => a.order - b.order)
      .map((inst, idx) => `${idx + 1}. ${inst.instruction}`)
      .join("\n");

    const prompt = `You are a nutritionist and pricing expert. Analyze the following recipe and provide:
      1. COMPLETE and EXHAUSTIVE nutritional information - include ALL macros, vitamins, minerals, fatty acids, amino acids, antioxidants, and any other nutritional compounds present in the recipe
      2. Estimated cost to cook this recipe in three markets: Indian (INR), Norwegian (NOK), and American (USD)
      3. Seasonality and cultural / occasion suitability of the dish across India, Norway, and the United States
      
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
      
      SEASONALITY INSTRUCTIONS:
      - Infer when and on which occasions this dish is commonly consumed
      - Consider climate, temperature, richness, freshness, cultural habits, and traditional usage
      - Include seasonality and occasions as a SINGLE array of strings called "seasonality"
      - Combine seasons and occasions in the same array
      - Include region-specific context (Indian, Norwegian, American) where relevant
      - Use lowercase snake_case for all seasonality values
      - Include multiple values if applicable
      - If the dish is commonly eaten year-round, include "all_seasons"
      
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
        },
        "seasonality": ["winter", "diwali", "christmas", "summer_bbq"]
      }
      
      Rules:
      - Use snake_case for all macro keys
      - Automatically analyze each ingredient and identify ALL nutritional compounds it contains
      - Include ALL nutritional values you can identify from the ingredients
      - Prices should be realistic market estimates for the total recipe cost
      - Return ONLY the JSON object, no additional text or explanation
      - The macros object should be comprehensive and include every nutritional compound you can automatically identify from the ingredients`;

    const systemPrompt =
      "You are a comprehensive nutritionist and pricing expert. You automatically analyze ingredients and identify ALL nutritional compounds present (macros, vitamins, minerals, fatty acids, amino acids, antioxidants, phytochemicals, etc.). You include everything you detect, not just common nutrients. Always use snake_case for all keys. Always respond with valid JSON only, no additional text.";

    const completion = await this.chatOpenAI(systemPrompt, prompt, []);
    const response = completion.choices[0]?.message?.content;

    if (!response) {
      throw new Error("No response from OpenAI API");
    }

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

      // Extract token usage from OpenAI API response
      const tokens = {
        prompt_tokens: completion.usage?.prompt_tokens || 0,
        completion_tokens: completion.usage?.completion_tokens || 0,
        total_tokens: completion.usage?.total_tokens || 0,
      };
      let seasonality: string[] = [];
      if (
        parsed.seasonality &&
        typeof parsed.seasonality === "object" &&
        Array.isArray(parsed.seasonality)
      ) {
        seasonality =
          parsed.seasonality?.map(
            (item: string) => item?.toLowerCase().replace(/ /g, "_") || ""
          ) || [];
      }

      return { macros, prices, tokens, seasonality };
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
