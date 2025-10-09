import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { Language } from "./Language";
import { RecipePreference } from "./RecipePreference";

@Entity("recipe_preference_translation", { schema: "public" })
export class RecipePreferenceTranslation {
  @PrimaryGeneratedColumn({ type: "integer", name: "id" })
  id: number;

  @Column("character varying", { name: "name" })
  name: string;

  @Column("character varying", { name: "description" })
  description: string;

  @Column("character varying", { name: "image", nullable: true })
  image: string | null;

  @ManyToOne(
    () => Language,
    (language) => language.recipePreferenceTranslations
  )
  @JoinColumn([{ name: "languageId", referencedColumnName: "id" }])
  language: Language;

  @ManyToOne(
    () => RecipePreference,
    (recipePreference) => recipePreference.recipePreferenceTranslations
  )
  @JoinColumn([{ name: "recipePreferenceId", referencedColumnName: "id" }])
  recipePreference: RecipePreference;
}
