import {
  Column,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { User } from "./User";

@Index("UQ_9d34efa504d4ea976337de5e7f9", ["userUid"], { unique: true })
@Entity("subscription", { schema: "public" })
export class Subscription {
  @PrimaryGeneratedColumn({ type: "integer", name: "id" })
  id: number;

  @Column("character varying", { name: "orderId", nullable: true })
  orderId: string | null;

  @Column("character varying", { name: "provider", nullable: true })
  provider: string | null;

  @Column("character varying", { name: "status", default: () => "'none'" })
  status: string;

  @Column("json", { name: "recipt", nullable: true })
  recipt: object | null;

  @Column("character varying", {
    name: "userUid",
    nullable: true,
    unique: true,
  })
  userUid: string | null;

  @Column("integer", { name: "expiresAt", nullable: true })
  expiresAt: number | null;

  @OneToOne(() => User, (user) => user.subscription, { onDelete: "CASCADE" })
  @JoinColumn([{ name: "userUid", referencedColumnName: "uid" }])
  userU: User;
}
