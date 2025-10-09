import { Column, Entity, JoinColumn, ManyToOne } from "typeorm";
import { Bundle } from "./Bundle";
import { Recipe } from "./Recipe";

@Entity("bundle_recipe", { schema: "public" })
export class BundleRecipe {
  @Column("uuid", { primary: true, name: "bundleId" })
  bundleId: string;

  @Column("uuid", { primary: true, name: "recipeId" })
  recipeId: string;

  @Column("integer", { name: "order" })
  order: number;

  @Column("boolean", { name: "isFree", default: () => "false" })
  isFree: boolean;

  @Column("timestamp without time zone", { name: "deletedAt", nullable: true })
  deletedAt: Date | null;

  @ManyToOne(() => Bundle, (bundle) => bundle.bundleRecipes)
  @JoinColumn([{ name: "bundleId", referencedColumnName: "id" }])
  bundle: Bundle;

  @ManyToOne(() => Recipe, (recipe) => recipe.bundleRecipes)
  @JoinColumn([{ name: "recipeId", referencedColumnName: "id" }])
  recipe: Recipe;
}
