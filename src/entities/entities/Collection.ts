import {
  Column,
  Entity,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
} from "typeorm";
import { User } from "./User";
import { Recipe } from "./Recipe";

@Entity("collection", { schema: "public" })
export class Collection {
  @Column("uuid", {
    primary: true,
    name: "id",
    default: () => "uuid_generate_v4()",
  })
  id: string;

  @Column("character varying", { name: "name", nullable: true })
  name: string | null;

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

  @ManyToOne(() => User, (user) => user.collections)
  @JoinColumn([{ name: "userUid", referencedColumnName: "uid" }])
  userU: User;

  @ManyToMany(() => Recipe, (recipe) => recipe.collections)
  @JoinTable({
    name: "collection_recipes_recipe",
    joinColumns: [{ name: "collectionId", referencedColumnName: "id" }],
    inverseJoinColumns: [{ name: "recipeId", referencedColumnName: "id" }],
    schema: "public",
  })
  recipes: Recipe[];
}
