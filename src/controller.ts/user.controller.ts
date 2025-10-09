import { Request, Response } from "express";
import { User } from "../entities/entities/User";
import { AppDataSource } from "../db";
import { Like } from "typeorm";
import { ChatbotService } from "../services/chatbot.service";
import { Recipe } from "../entities/entities/Recipe";
import { Like as LikeRepo } from "../entities/entities/Like";
import { EmbeddingsService } from "../services/embeddings.service";

const ApiKey = process.env.AI_KEY;

export class UserController {
  static async search(req: Request, res: Response) {
    try {
      const { user } = req.query;

      const userRepository = AppDataSource.getRepository(User);
      const data = await userRepository
        .findOne({
          where: {
            username: Like(`%${user}%`),
          },
        })
        .catch((err) => console.log(err));
      if (!data) {
        return res.status(404).json({
          message: "User not found",
        });
      }
      res.status(200).json({
        message: "User searched successfully",
        username: data.username,
        userId: data.uid,
      });
    } catch (error) {
      res.status(500).json({
        message: "Internal server error",
        error: error,
      });
    }
  }
  static async generateVector(req: Request, res: Response) {
    try {
      const queryRunner = AppDataSource.createQueryRunner();
      await queryRunner.connect();
      try {
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector;`);
        await queryRunner.query(
          `ALTER TABLE recipe ADD COLUMN IF NOT EXISTS embedding vector(768);`
        );
        await queryRunner.query(
          `CREATE INDEX IF NOT EXISTS recipe_embedding_idx ON recipe USING ivfflat (embedding vector_cosine_ops);`
        );
        res.status(200).json({
          message:
            "Vector extension enabled, embedding column added, and index created successfully.",
        });
      } finally {
        await queryRunner.release();
      }
    } catch (error) {
      res.status(500).json({
        message: "Internal server error",
        error: error,
      });
    }
  }
  static async chat(req: Request, res: Response) {
    try {
      const { username } = req.params;
      const { message } = req.body;
      const userRepository = AppDataSource.getRepository(User);
      const data = await userRepository
        .findOne({
          where: {
            username: Like(`%${username}%`),
          },
        })
        .catch((err) => console.log(err));
      if (!data) {
        return res.status(404).json({
          message: "User not found",
        });
      }
      const userId = data.uid;
      const chatbotService = new ChatbotService();

      const aiResponse = await chatbotService.ask(userId, message);

      return res.status(200).json({
        user: username,
        question: message,
        response: aiResponse,
      });
    } catch (error) {
      res.status(500).json({
        message: "Internal server error",
        error: error,
      });
    }
  }
  static async getUserResponse(req: Request, res: Response) {
    try {
      const [UserRepository, RecipeRepository, LikeRepository] =
        await Promise.all([
          AppDataSource.getRepository(User),
          AppDataSource.getRepository(Recipe),
          AppDataSource.getRepository(LikeRepo),
        ]);
      const { username } = req.params;

      const user = await UserRepository.findOne({
        where: {
          username: Like(`%${username}%`),
        },
      });
      if (!user) {
        return res.status(404).json({
          message: "User not found",
        });
      }

      const results = await RecipeRepository.find({
        where: {
          userU: {
            uid: user.uid,
          },
        },
      });
      const likedRecipes = await RecipeRepository.createQueryBuilder("recipe")
        .innerJoin(
          LikeRepo,
          "lk",
          '"lk"."entityType" = :entityType AND "lk"."userUid" = :uid AND "recipe"."id"::text = "lk"."entityId"',
          { entityType: "recipe", uid: user.uid }
        )
        .getMany();
      return res.status(200).json({
        userRecipes: results,
        likedRecipes,
        user,
      });
    } catch (error) {
      res.status(500).json({
        message: "Internal server error",
        error: error,
      });
    }
  }

  static async generateEmbeddings(req: Request, res: Response) {
    try {
      const embeddingsService = new EmbeddingsService();
      const { username } = req.params;

      // First find the user
      const user = await AppDataSource.query(
        `SELECT uid FROM "user" WHERE username = $1`,
        [username]
      );

      if (!user || user.length === 0) {
        return res.status(404).json({
          message: "User not found",
        });
      }

      const userUid = user[0].uid;

      // Get only this user's recipes that need embeddings
      const recipes = await AppDataSource.query(
        `
        SELECT r.id, r.name as recipe_name, r.ingress, r.difficulty, r.servings, r."prepTime", r."cookTime"
        FROM recipe r
        WHERE r."userUid" = $1
          AND r.status = 'published' 
          AND r."deletedAt" IS NULL
          AND r.embedding IS NULL
        ORDER BY r.id
        `,
        [userUid]
      );

      // Process each recipe individually to avoid complex joins
      const recipesToProcess = [];

      for (const recipe of recipes) {
        // Get ingredients for this recipe
        const ingredients = await AppDataSource.query(
          `
          SELECT ri.amount, ri.section, ri."order" as ingredient_order,
                 i.name as ingredient_name,
                 mut.name as measuring_unit_name
          FROM recipe_ingredient ri
          LEFT JOIN ingredient i ON ri."ingredientId" = i.id
          LEFT JOIN measuring_unit mu ON ri."unitId" = mu.id
          LEFT JOIN measuring_unit_translation mut ON mu.id = mut."measuringUnitId"
          WHERE ri."recipeId" = $1
          ORDER BY ri."order"
          `,
          [recipe.id]
        );

        // Get instructions for this recipe
        const instructions = await AppDataSource.query(
          `
          SELECT description, "order" as instruction_order
          FROM recipe_instruction
          WHERE "recipeId" = $1
          ORDER BY "order"
          `,
          [recipe.id]
        );

        recipesToProcess.push({
          id: recipe.id,
          name: recipe.recipe_name,
          ingress: recipe.ingress,
          difficulty: recipe.difficulty,
          servings: recipe.servings,
          prepTime: recipe.prepTime,
          cookTime: recipe.cookTime,
          ingredients: ingredients.map((ing: any) => ({
            name: ing.ingredient_name,
            amount: ing.amount,
            unit: ing.measuring_unit_name,
            order: ing.ingredient_order,
          })),
          instructions: instructions.map((inst: any) => ({
            description: inst.description,
            order: inst.instruction_order,
          })),
        });
      }
      let processed = 0;
      let errors = 0;

      for (const recipe of recipesToProcess) {
        try {
          // Prepare recipe text for embedding
          const recipeText = embeddingsService.prepareRecipeText(recipe);

          // Generate embedding
          const embedding = await embeddingsService.generateEmbedding(
            recipeText
          );

          // Store embedding in database
          await AppDataSource.query(
            `UPDATE recipe SET embedding = $1 WHERE id = $2`,
            [JSON.stringify(embedding), recipe.id]
          );

          processed++;
          console.log(
            `Processed recipe ${recipe.name} (${processed}/${recipesToProcess.length})`
          );
        } catch (error) {
          console.error(`Error processing recipe ${recipe.name}:`, error);
          errors++;
        }
      }

      res.status(200).json({
        message: "Embeddings generation completed",
        processed,
        errors,
        total: recipesToProcess.length,
      });
    } catch (error) {
      res.status(500).json({
        message: "Internal server error",
        error: error,
      });
    }
  }
}
