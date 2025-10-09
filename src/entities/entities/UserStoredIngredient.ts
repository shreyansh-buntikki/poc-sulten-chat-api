import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { Ingredient } from "./Ingredient";
import { User } from "./User";

@Index("IDX_5debbf6553ac09fae2a2496447", ["id"], {})
@Index("IDX_f08c61848e3a8cdccf0e7b24c0", ["ingredientId"], {})
@Index("UQ_5ac29d63eee6127d73b1995d9d3", ["ingredientId", "userUid"], {
  unique: true,
})
@Index("IDX_6a1c6a28a277929c5f349d57ef", ["userUid"], {})
@Entity("user_stored_ingredient", { schema: "public" })
export class UserStoredIngredient {
  @Column("uuid", {
    primary: true,
    name: "id",
    default: () => "uuid_generate_v4()",
  })
  id: string;

  @Column("boolean", { name: "is_priority", default: () => "false" })
  isPriority: boolean;

  @Column("character varying", {
    name: "userUid",
    nullable: true,
    unique: true,
  })
  userUid: string | null;

  @Column("uuid", { name: "ingredientId", nullable: true, unique: true })
  ingredientId: string | null;

  @Column("timestamp without time zone", {
    name: "createdAt",
    default: () => "now()",
  })
  createdAt: Date;

  @ManyToOne(() => Ingredient, (ingredient) => ingredient.userStoredIngredients)
  @JoinColumn([{ name: "ingredientId", referencedColumnName: "id" }])
  ingredient: Ingredient;

  @ManyToOne(() => User, (user) => user.userStoredIngredients, {
    onDelete: "CASCADE",
  })
  @JoinColumn([{ name: "userUid", referencedColumnName: "uid" }])
  userU: User;
}
