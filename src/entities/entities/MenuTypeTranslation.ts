import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { Language } from "./Language";
import { MenuType } from "./MenuType";

@Entity("menu_type_translation", { schema: "public" })
export class MenuTypeTranslation {
  @PrimaryGeneratedColumn({ type: "integer", name: "id" })
  id: number;

  @Column("character varying", { name: "name", nullable: true })
  name: string | null;

  @ManyToOne(() => Language, (language) => language.menuTypeTranslations)
  @JoinColumn([{ name: "languageId", referencedColumnName: "id" }])
  language: Language;

  @ManyToOne(() => MenuType, (menuType) => menuType.menuTypeTranslations)
  @JoinColumn([{ name: "menuTypeId", referencedColumnName: "id" }])
  menuType: MenuType;
}
