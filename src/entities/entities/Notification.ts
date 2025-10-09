import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { User } from "./User";

@Index("IDX_b11a5e627c41d4dc3170f1d370", ["createdAt"], {})
@Index("IDX_6d65d0d7a0436d123ca90db30c", ["read", "userUid"], {})
@Entity("notification", { schema: "public" })
export class Notification {
  @Column("uuid", {
    primary: true,
    name: "id",
    default: () => "uuid_generate_v4()",
  })
  id: string;

  @Column("jsonb", { name: "data" })
  data: object;

  @Column("boolean", { name: "read", default: () => "false" })
  read: boolean;

  @Column("character varying", { name: "messageId" })
  messageId: string;

  @Column("character varying", { name: "userUid", nullable: true })
  userUid: string | null;

  @Column("enum", {
    name: "type",
    enum: [
      "recipe_like",
      "recipe_comment",
      "video_like",
      "video_comment",
      "comment_replay",
    ],
  })
  type:
    | "recipe_like"
    | "recipe_comment"
    | "video_like"
    | "video_comment"
    | "comment_replay";

  @Column("timestamp with time zone", {
    name: "createdAt",
    default: () => "now()",
  })
  createdAt: Date;

  @ManyToOne(() => User, (user) => user.notifications)
  @JoinColumn([{ name: "userUid", referencedColumnName: "uid" }])
  userU: User;
}
