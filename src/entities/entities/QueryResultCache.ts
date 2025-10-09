import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity("query-result-cache", { schema: "public" })
export class QueryResultCache {
  @PrimaryGeneratedColumn({ type: "integer", name: "id" })
  id: number;

  @Column("character varying", { name: "identifier", nullable: true })
  identifier: string | null;

  @Column("bigint", { name: "time" })
  time: string;

  @Column("integer", { name: "duration" })
  duration: number;

  @Column("text", { name: "query" })
  query: string;

  @Column("text", { name: "result" })
  result: string;
}
