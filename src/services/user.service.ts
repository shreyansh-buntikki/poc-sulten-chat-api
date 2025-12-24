import { AppDataSource } from "../db";
import { User } from "../entities/entities/User";
import { Recipe } from "../entities/entities/Recipe";
import { Like as LikeRepo } from "../entities/entities/Like";
import { Like } from "typeorm";

export class UserService {
  /**
   * Search users by username
   */
  static async searchUsers(username: string) {
    const userRepository = AppDataSource.getRepository(User);
    const data = await userRepository
      .find({
        where: {
          username: Like(`%${username}%`),
        },
      })
      .catch((err) => console.log(err));

    if (!data) {
      throw new Error("User not found");
    }

    return data;
  }

  /**
   * Get user by username
   */
  static async getUserByUsername(username: string) {
    const user = await AppDataSource.query(
      `SELECT uid FROM "user" WHERE username = $1`,
      [username]
    );

    if (!user || user.length === 0) {
      throw new Error("User not found");
    }

    return user[0];
  }

  /**
   * Get user by username with TypeORM
   */
  static async getUserByUsernameTypeORM(username: string) {
    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({
      where: {
        username: Like(`%${username}%`),
      },
    });

    if (!user) {
      throw new Error("User not found");
    }

    return user;
  }

  /**
   * Get user recipes and liked recipes
   */
  static async getUserRecipesAndLikes(username: string) {
    const [UserRepository, RecipeRepository] = await Promise.all([
      AppDataSource.getRepository(User),
      AppDataSource.getRepository(Recipe),
    ]);

    const user = await UserRepository.findOne({
      where: {
        username: Like(`%${username}%`),
      },
    });

    if (!user) {
      throw new Error("User not found");
    }

    const [results, likedRecipes] = await Promise.all([
      RecipeRepository.find({
        where: {
          userU: {
            uid: user.uid,
          },
        },
      }),
      RecipeRepository.createQueryBuilder("recipe")
        .innerJoin(
          LikeRepo,
          "lk",
          '"lk"."entityType" = :entityType AND "lk"."userUid" = :uid AND "recipe"."id"::text = "lk"."entityId"',
          { entityType: "recipe", uid: user.uid }
        )
        .getMany(),
    ]);

    return {
      user,
      userRecipes: results,
      likedRecipes,
    };
  }
}
