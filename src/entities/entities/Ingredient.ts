import {
  Column,
  Entity,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  OneToMany,
} from "typeorm";
import { Language } from "./Language";
import { RecipeIngredient } from "./RecipeIngredient";
import { RecipeInstruction } from "./RecipeInstruction";
import { UserStoredIngredient } from "./UserStoredIngredient";

@Entity("ingredient", { schema: "public" })
export class Ingredient {
  @Column("uuid", {
    primary: true,
    name: "id",
    default: () => "uuid_generate_v4()",
  })
  id: string;

  @Column("character varying", { name: "name" })
  name: string;

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

  @ManyToOne(() => Language, (language) => language.ingredients)
  @JoinColumn([{ name: "languageId", referencedColumnName: "id" }])
  language: Language;

  @OneToMany(
    () => RecipeIngredient,
    (recipeIngredient) => recipeIngredient.ingredient
  )
  recipeIngredients: RecipeIngredient[];

  @ManyToMany(
    () => RecipeInstruction,
    (recipeInstruction) => recipeInstruction.ingredients
  )
  @JoinTable({
    name: "recipe_instruction_selected_ingredients_ingredient",
    joinColumns: [{ name: "ingredientId", referencedColumnName: "id" }],
    inverseJoinColumns: [
      { name: "recipeInstructionId", referencedColumnName: "id" },
    ],
    schema: "public",
  })
  recipeInstructions: RecipeInstruction[];

  @OneToMany(
    () => UserStoredIngredient,
    (userStoredIngredient) => userStoredIngredient.ingredient
  )
  userStoredIngredients: UserStoredIngredient[];
}
