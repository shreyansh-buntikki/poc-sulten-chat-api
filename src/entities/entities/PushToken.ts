import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { Language } from "./Language";
import { User } from "./User";

@Index("IDX_ae6853aba3ad5fe0b6b0db1502", ["token"], {})
@Index("IDX_d312a7944e8ed194e580ec7212", ["userUid"], {})
@Entity("push_token", { schema: "public" })
export class PushToken {
  @Column("character varying", { primary: true, name: "token" })
  token: string;

  @Column("timestamp without time zone", {
    name: "lastUpdatedAt",
    default: () => "now()",
  })
  lastUpdatedAt: Date;

  @Column("character varying", { name: "userUid", nullable: true })
  userUid: string | null;

  @ManyToOne(() => Language, (language) => language.pushTokens)
  @JoinColumn([{ name: "languageId", referencedColumnName: "id" }])
  language: Language;

  @ManyToOne(() => User, (user) => user.pushTokens)
  @JoinColumn([{ name: "userUid", referencedColumnName: "uid" }])
  userU: User;
}
