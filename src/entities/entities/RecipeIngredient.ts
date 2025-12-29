import { Column, Entity, JoinColumn, ManyToOne } from "typeorm";
import { Ingredient } from "./Ingredient";
import { Recipe } from "./Recipe";
import { MeasuringUnit } from "./MeasuringUnit";

@Entity("recipe_ingredient", { schema: "public" })
export class RecipeIngredient {
  @Column("uuid", {
    primary: true,
    name: "id",
    default: () => "uuid_generate_v4()",
  })
  id: string;

  @Column("double precision", { name: "amount", nullable: true })
  amount: number | null;

  @Column("character varying", { name: "section", nullable: true })
  section: string | null;

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

  @Column("timestamp without time zone", { name: "deletedAt", nullable: true })
  deletedAt: Date | null;

  @Column("integer", { name: "order", nullable: true })
  order: number | null;

  @ManyToOne(() => Ingredient, (ingredient) => ingredient.recipeIngredients, {
    onDelete: "CASCADE",
  })
  @JoinColumn([{ name: "ingredientId", referencedColumnName: "id" }])
  ingredient: Ingredient;

  @ManyToOne(() => Recipe, (recipe) => recipe.recipeIngredients, {
    onDelete: "CASCADE",
  })
  @JoinColumn([{ name: "recipeId", referencedColumnName: "id" }])
  recipe: Recipe;

  @ManyToOne(
    () => MeasuringUnit,
    (measuringUnit) => measuringUnit.recipeIngredients,
    { onDelete: "CASCADE" }
  )
  @JoinColumn([{ name: "unitId", referencedColumnName: "id" }])
  unit: MeasuringUnit;
}
