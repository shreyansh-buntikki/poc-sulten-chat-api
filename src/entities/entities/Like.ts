import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { User } from "./User";

@Index("IDX_db4d0f504899a144870074432f", ["entityId"], {})
@Index("UQ_63fcf48edaa0e1f6bd1ae3f736c", ["entityId", "userUid"], {
  unique: true,
})
@Index("IDX_71f710683a91d2c7cd28bf471d", ["entityType"], {})
@Entity("like", { schema: "public" })
export class Like {
  @Column("uuid", {
    primary: true,
    name: "id",
    default: () => "uuid_generate_v4()",
  })
  id: string;

  @Column("character varying", { name: "entityId", unique: true })
  entityId: string;

  @Column("character varying", { name: "entityType" })
  entityType: string;

  @Column("timestamp without time zone", {
    name: "createdAt",
    default: () => "now()",
  })
  createdAt: Date;

  @Column("character varying", {
    name: "userUid",
    nullable: true,
    unique: true,
  })
  userUid: string | null;

  @ManyToOne(() => User, (user) => user.likes)
  @JoinColumn([{ name: "userUid", referencedColumnName: "uid" }])
  userU: User;
}
