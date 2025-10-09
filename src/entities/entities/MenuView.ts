import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { Menu } from "./Menu";
import { User } from "./User";

@Index("IDX_d1d2ce4eaf554f5d4aab6d62c4", ["id"], {})
@Entity("menu_view", { schema: "public" })
export class MenuView {
  @Column("uuid", {
    primary: true,
    name: "id",
    default: () => "uuid_generate_v4()",
  })
  id: string;

  @Column("timestamp with time zone", {
    name: "viewedAt",
    nullable: true,
    default: () => "now()",
  })
  viewedAt: Date | null;

  @ManyToOne(() => Menu, (menu) => menu.menuViews)
  @JoinColumn([{ name: "menuId", referencedColumnName: "id" }])
  menu: Menu;

  @ManyToOne(() => User, (user) => user.menuViews)
  @JoinColumn([{ name: "userUid", referencedColumnName: "uid" }])
  userU: User;
}
