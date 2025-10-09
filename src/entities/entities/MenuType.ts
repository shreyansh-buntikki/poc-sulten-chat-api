import { Column, Entity, OneToMany } from "typeorm";
import { Menu } from "./Menu";
import { MenuTypeTranslation } from "./MenuTypeTranslation";

@Entity("menu_type", { schema: "public" })
export class MenuType {
  @Column("uuid", {
    primary: true,
    name: "id",
    default: () => "uuid_generate_v4()",
  })
  id: string;

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

  @OneToMany(() => Menu, (menu) => menu.menuType)
  menus: Menu[];

  @OneToMany(
    () => MenuTypeTranslation,
    (menuTypeTranslation) => menuTypeTranslation.menuType
  )
  menuTypeTranslations: MenuTypeTranslation[];
}
