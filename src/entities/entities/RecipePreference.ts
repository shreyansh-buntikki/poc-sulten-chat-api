import { Column, Entity, ManyToMany, OneToMany } from "typeorm";
import { RecipePreferenceTranslation } from "./RecipePreferenceTranslation";
import { Recipe } from "./Recipe";

@Entity("recipe_preference", { schema: "public" })
export class RecipePreference {
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

  @OneToMany(
    () => RecipePreferenceTranslation,
    (recipePreferenceTranslation) =>
      recipePreferenceTranslation.recipePreference
  )
  recipePreferenceTranslations: RecipePreferenceTranslation[];

  @ManyToMany(() => Recipe, (recipe) => recipe.recipePreferences)
  recipes: Recipe[];
}
