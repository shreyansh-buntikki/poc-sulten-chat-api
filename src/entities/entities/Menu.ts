import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from "typeorm";
import { Language } from "./Language";
import { MenuType } from "./MenuType";
import { User } from "./User";
import { MenuRecipe } from "./MenuRecipe";
import { MenuView } from "./MenuView";

@Index("IDX_c4d9533c4ce3f7902c786141e1", ["slug"], {})
@Index("UQ_c4d9533c4ce3f7902c786141e1a", ["slug"], { unique: true })
@Entity("menu", { schema: "public" })
export class Menu {
  @Column("uuid", {
    primary: true,
    name: "id",
    default: () => "uuid_generate_v4()",
  })
  id: string;

  @Column("character varying", { name: "name", nullable: true })
  name: string | null;

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

  @Column("character varying", { name: "slug", nullable: true, unique: true })
  slug: string | null;

  @Column("boolean", { name: "private", default: () => "false" })
  private: boolean;

  @ManyToOne(() => Language, (language) => language.menus)
  @JoinColumn([{ name: "languageId", referencedColumnName: "id" }])
  language: Language;

  @ManyToOne(() => MenuType, (menuType) => menuType.menus)
  @JoinColumn([{ name: "menuTypeId", referencedColumnName: "id" }])
  menuType: MenuType;

  @ManyToOne(() => User, (user) => user.menus)
  @JoinColumn([{ name: "userUid", referencedColumnName: "uid" }])
  userU: User;

  @OneToMany(() => MenuRecipe, (menuRecipe) => menuRecipe.menu)
  menuRecipes: MenuRecipe[];

  @OneToMany(() => MenuView, (menuView) => menuView.menu)
  menuViews: MenuView[];
}
