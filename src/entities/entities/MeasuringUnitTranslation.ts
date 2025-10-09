import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { Language } from "./Language";
import { MeasuringUnit } from "./MeasuringUnit";

@Entity("measuring_unit_translation", { schema: "public" })
export class MeasuringUnitTranslation {
  @PrimaryGeneratedColumn({ type: "integer", name: "id" })
  id: number;

  @Column("character varying", { name: "name", nullable: true })
  name: string | null;

  @Column("character varying", { name: "longName", nullable: true })
  longName: string | null;

  @ManyToOne(() => Language, (language) => language.measuringUnitTranslations)
  @JoinColumn([{ name: "languageId", referencedColumnName: "id" }])
  language: Language;

  @ManyToOne(
    () => MeasuringUnit,
    (measuringUnit) => measuringUnit.measuringUnitTranslations
  )
  @JoinColumn([{ name: "measuringUnitId", referencedColumnName: "id" }])
  measuringUnit: MeasuringUnit;
}
