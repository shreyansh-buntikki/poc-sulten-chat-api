import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { Language } from "./Language";
import { RecipeType } from "./RecipeType";

@Entity("recipe_type_translation", { schema: "public" })
export class RecipeTypeTranslation {
  @PrimaryGeneratedColumn({ type: "integer", name: "id" })
  id: number;

  @Column("character varying", { name: "name", nullable: true })
  name: string | null;

  @ManyToOne(() => Language, (language) => language.recipeTypeTranslations)
  @JoinColumn([{ name: "languageId", referencedColumnName: "id" }])
  language: Language;

  @ManyToOne(
    () => RecipeType,
    (recipeType) => recipeType.recipeTypeTranslations
  )
  @JoinColumn([{ name: "recipeTypeId", referencedColumnName: "id" }])
  recipeType: RecipeType;
}
