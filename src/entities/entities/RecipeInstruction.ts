import { Column, Entity, JoinColumn, ManyToMany, ManyToOne } from "typeorm";
import { Recipe } from "./Recipe";
import { Ingredient } from "./Ingredient";

@Entity("recipe_instruction", { schema: "public" })
export class RecipeInstruction {
  @Column("uuid", {
    primary: true,
    name: "id",
    default: () => "uuid_generate_v4()",
  })
  id: string;

  @Column("character varying", { name: "description", nullable: true })
  description: string | null;

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

  @Column("character varying", { name: "image", nullable: true })
  image: string | null;

  @Column("timestamp without time zone", { name: "deletedAt", nullable: true })
  deletedAt: Date | null;

  @Column("integer", { name: "order", nullable: true })
  order: number | null;

  @ManyToOne(() => Recipe, (recipe) => recipe.recipeInstructions, {
    onDelete: "CASCADE",
  })
  @JoinColumn([{ name: "recipeId", referencedColumnName: "id" }])
  recipe: Recipe;

  @ManyToMany(() => Ingredient, (ingredient) => ingredient.recipeInstructions)
  ingredients: Ingredient[];
}
