import { Column, Entity, OneToMany } from "typeorm";
import { MeasuringUnitTranslation } from "./MeasuringUnitTranslation";
import { RecipeIngredient } from "./RecipeIngredient";

@Entity("measuring_unit", { schema: "public" })
export class MeasuringUnit {
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

  @OneToMany(
    () => MeasuringUnitTranslation,
    (measuringUnitTranslation) => measuringUnitTranslation.measuringUnit
  )
  measuringUnitTranslations: MeasuringUnitTranslation[];

  @OneToMany(
    () => RecipeIngredient,
    (recipeIngredient) => recipeIngredient.unit
  )
  recipeIngredients: RecipeIngredient[];
}
