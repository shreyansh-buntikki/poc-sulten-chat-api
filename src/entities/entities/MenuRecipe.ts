import { Column, Entity, JoinColumn, ManyToOne } from "typeorm";
import { Menu } from "./Menu";
import { Recipe } from "./Recipe";

@Entity("menu_recipe", { schema: "public" })
export class MenuRecipe {
  @Column("uuid", { primary: true, name: "menuId" })
  menuId: string;

  @Column("uuid", { primary: true, name: "recipeId" })
  recipeId: string;

  @Column("integer", { name: "order" })
  order: number;

  @ManyToOne(() => Menu, (menu) => menu.menuRecipes)
  @JoinColumn([{ name: "menuId", referencedColumnName: "id" }])
  menu: Menu;

  @ManyToOne(() => Recipe, (recipe) => recipe.menuRecipes)
  @JoinColumn([{ name: "recipeId", referencedColumnName: "id" }])
  recipe: Recipe;
}
