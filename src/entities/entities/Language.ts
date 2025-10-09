import { Column, Entity, Index, OneToMany } from "typeorm";
import { Ingredient } from "./Ingredient";
import { MeasuringUnitTranslation } from "./MeasuringUnitTranslation";
import { Menu } from "./Menu";
import { MenuTypeTranslation } from "./MenuTypeTranslation";
import { PushToken } from "./PushToken";
import { Recipe } from "./Recipe";
import { RecipePreferenceTranslation } from "./RecipePreferenceTranslation";
import { RecipeTypeTranslation } from "./RecipeTypeTranslation";

@Index("IDX_cc0a99e710eb3733f6fb42b1d4", ["id"], {})
@Entity("language", { schema: "public" })
export class Language {
  @Column("character varying", { primary: true, name: "id" })
  id: string;

  @Column("character varying", { name: "name" })
  name: string;

  @Column("character varying", { name: "globalName", nullable: true })
  globalName: string | null;

  @OneToMany(() => Ingredient, (ingredient) => ingredient.language)
  ingredients: Ingredient[];

  @OneToMany(
    () => MeasuringUnitTranslation,
    (measuringUnitTranslation) => measuringUnitTranslation.language
  )
  measuringUnitTranslations: MeasuringUnitTranslation[];

  @OneToMany(() => Menu, (menu) => menu.language)
  menus: Menu[];

  @OneToMany(
    () => MenuTypeTranslation,
    (menuTypeTranslation) => menuTypeTranslation.language
  )
  menuTypeTranslations: MenuTypeTranslation[];

  @OneToMany(() => PushToken, (pushToken) => pushToken.language)
  pushTokens: PushToken[];

  @OneToMany(() => Recipe, (recipe) => recipe.language)
  recipes: Recipe[];

  @OneToMany(
    () => RecipePreferenceTranslation,
    (recipePreferenceTranslation) => recipePreferenceTranslation.language
  )
  recipePreferenceTranslations: RecipePreferenceTranslation[];

  @OneToMany(
    () => RecipeTypeTranslation,
    (recipeTypeTranslation) => recipeTypeTranslation.language
  )
  recipeTypeTranslations: RecipeTypeTranslation[];
}
