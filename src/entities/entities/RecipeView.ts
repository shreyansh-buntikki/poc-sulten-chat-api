import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { Recipe } from "./Recipe";
import { User } from "./User";

@Index("IDX_479962210730fb9f98530bccbc", ["id"], {})
@Entity("recipe_view", { schema: "public" })
export class RecipeView {
  @Column("uuid", {
    primary: true,
    name: "id",
    default: () => "uuid_generate_v4()",
  })
  id: string;

  @Column("timestamp with time zone", {
    name: "viewedAt",
    nullable: true,
    default: () => "now()",
  })
  viewedAt: Date | null;

  @ManyToOne(() => Recipe, (recipe) => recipe.recipeViews)
  @JoinColumn([{ name: "recipeId", referencedColumnName: "id" }])
  recipe: Recipe;

  @ManyToOne(() => User, (user) => user.recipeViews)
  @JoinColumn([{ name: "userUid", referencedColumnName: "uid" }])
  userU: User;
}
