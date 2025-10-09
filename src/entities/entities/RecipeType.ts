import { Column, Entity, ManyToMany, OneToMany } from "typeorm";
import { Recipe } from "./Recipe";
import { RecipeTypeTranslation } from "./RecipeTypeTranslation";

@Entity("recipe_type", { schema: "public" })
export class RecipeType {
  @Column("uuid", {
    primary: true,
    name: "id",
    default: () => "uuid_generate_v4()",
  })
  id: string;

  @Column("timestamp without time zone", {
    name: "createdAt",
    default: () => "now()",
  })
  createdAt: Date;

  @Column("timestamp without time zone", {
    name: "updatedAt",
    default: () => "now()",
  })
  updatedAt: Date;

  @ManyToMany(() => Recipe, (recipe) => recipe.recipeTypes)
  recipes: Recipe[];

  @OneToMany(
    () => RecipeTypeTranslation,
    (recipeTypeTranslation) => recipeTypeTranslation.recipeType
  )
  recipeTypeTranslations: RecipeTypeTranslation[];
}
