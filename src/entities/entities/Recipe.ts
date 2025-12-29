import {
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  OneToMany,
} from "typeorm";
import { BundleRecipe } from "./BundleRecipe";
import { Collection } from "./Collection";
import { MenuRecipe } from "./MenuRecipe";
import { Language } from "./Language";
import { User } from "./User";
import { RecipeIngredient } from "./RecipeIngredient";
import { RecipeInstruction } from "./RecipeInstruction";
import { RecipePreference } from "./RecipePreference";
import { RecipeType } from "./RecipeType";
import { Tag } from "./Tag";
import { RecipeView } from "./RecipeView";
import { Video } from "./Video";

@Index("IDX_e365a2fedf57238d970e07825c", ["id"], {})
@Index("IDX_a0484b1faa35e0741ec6467e3f", ["slug"], {})
@Index("UQ_a0484b1faa35e0741ec6467e3f1", ["slug"], { unique: true })
@Entity("recipe", { schema: "public" })
export class Recipe {
  @Column("uuid", {
    primary: true,
    name: "id",
    default: () => "uuid_generate_v4()",
  })
  id: string;

  @Column("character varying", { name: "name", nullable: true })
  name: string | null;

  @Column("character varying", { name: "slug", nullable: true, unique: true })
  slug: string | null;

  @Column("character varying", { name: "ingress", nullable: true })
  ingress: string | null;

  @Column("character varying", { name: "image", nullable: true })
  image: string | null;

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

  @Column("timestamp with time zone", {
    name: "publishedAt",
    nullable: true,
    default: () => "now()",
  })
  publishedAt: Date | null;

  @Column("character varying", { name: "status", default: () => "'draft'" })
  status: string;

  @Column("character varying", {
    name: "difficulty",
    default: () => "'medium'",
  })
  difficulty: string;

  @Column("integer", { name: "servings", nullable: true })
  servings: number | null;

  @Column("integer", { name: "prepTime", nullable: true })
  prepTime: number | null;

  @Column("integer", { name: "cookTime", nullable: true })
  cookTime: number | null;

  @Column("timestamp without time zone", { name: "deletedAt", nullable: true })
  deletedAt: Date | null;

  @Column("boolean", { name: "private", default: () => "false" })
  private: boolean;

  @Column("tsvector", { name: "search_vector", nullable: true })
  searchVector: string | null;

  @Column("text", { name: "meta", nullable: true })
  meta: string | null;

  @OneToMany(() => BundleRecipe, (bundleRecipe) => bundleRecipe.recipe)
  bundleRecipes: BundleRecipe[];

  @ManyToMany(() => Collection, (collection) => collection.recipes)
  collections: Collection[];

  @OneToMany(() => MenuRecipe, (menuRecipe) => menuRecipe.recipe)
  menuRecipes: MenuRecipe[];

  @ManyToOne(() => Language, (language) => language.recipes)
  @JoinColumn([{ name: "languageId", referencedColumnName: "id" }])
  language: Language;

  @ManyToOne(() => User, (user) => user.recipes)
  @JoinColumn([{ name: "userUid", referencedColumnName: "uid" }])
  userU: User;

  @OneToMany(
    () => RecipeIngredient,
    (recipeIngredient) => recipeIngredient.recipe
  )
  recipeIngredients: RecipeIngredient[];

  @OneToMany(
    () => RecipeInstruction,
    (recipeInstruction) => recipeInstruction.recipe
  )
  recipeInstructions: RecipeInstruction[];

  @ManyToMany(() => User, (user) => user.recipes2)
  @JoinTable({
    name: "recipe_liked_by_user",
    joinColumns: [{ name: "recipeId", referencedColumnName: "id" }],
    inverseJoinColumns: [{ name: "userUid", referencedColumnName: "uid" }],
    schema: "public",
  })
  users: User[];

  @ManyToMany(
    () => RecipePreference,
    (recipePreference) => recipePreference.recipes
  )
  @JoinTable({
    name: "recipe_recipe_preferences_recipe_preference",
    joinColumns: [{ name: "recipeId", referencedColumnName: "id" }],
    inverseJoinColumns: [
      { name: "recipePreferenceId", referencedColumnName: "id" },
    ],
    schema: "public",
  })
  recipePreferences: RecipePreference[];

  @ManyToMany(() => RecipeType, (recipeType) => recipeType.recipes)
  @JoinTable({
    name: "recipe_recipe_types_recipe_type",
    joinColumns: [{ name: "recipeId", referencedColumnName: "id" }],
    inverseJoinColumns: [{ name: "recipeTypeId", referencedColumnName: "id" }],
    schema: "public",
  })
  recipeTypes: RecipeType[];

  @ManyToMany(() => Tag, (tag) => tag.recipes)
  @JoinTable({
    name: "recipe_tags_tag",
    joinColumns: [{ name: "recipeId", referencedColumnName: "id" }],
    inverseJoinColumns: [{ name: "tagId", referencedColumnName: "id" }],
    schema: "public",
  })
  tags: Tag[];

  @OneToMany(() => RecipeView, (recipeView) => recipeView.recipe)
  recipeViews: RecipeView[];

  @ManyToMany(() => User, (user) => user.recipes3)
  @JoinTable({
    name: "user_likes_recipe",
    joinColumns: [{ name: "recipeId", referencedColumnName: "id" }],
    inverseJoinColumns: [{ name: "userUid", referencedColumnName: "uid" }],
    schema: "public",
  })
  users2: User[];

  @ManyToMany(() => Video, (video) => video.recipes)
  @JoinTable({
    name: "video_recipes_recipe",
    joinColumns: [{ name: "recipeId", referencedColumnName: "id" }],
    inverseJoinColumns: [{ name: "videoId", referencedColumnName: "id" }],
    schema: "public",
  })
  videos: Video[];
}
