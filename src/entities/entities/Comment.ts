import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from "typeorm";
import { User } from "./User";

@Index("IDX_2950cfa146fc50334efa61a70b", ["entityId"], {})
@Index("IDX_19bea390aaaf91276dec06e8b8", ["entityType"], {})
@Entity("comment", { schema: "public" })
export class Comment {
  @Column("uuid", {
    primary: true,
    name: "id",
    default: () => "uuid_generate_v4()",
  })
  id: string;

  @Column("character varying", { name: "entityId" })
  entityId: string;

  @Column("character varying", { name: "entityType" })
  entityType: string;

  @Column("text", { name: "text" })
  text: string;

  @Column("timestamp without time zone", {
    name: "createdAt",
    default: () => "now()",
  })
  createdAt: Date;

  @Column("timestamp without time zone", { name: "deletedAt", nullable: true })
  deletedAt: Date | null;

  @ManyToOne(() => Comment, (comment) => comment.comments)
  @JoinColumn([{ name: "parentCommentId", referencedColumnName: "id" }])
  parentComment: Comment;

  @OneToMany(() => Comment, (comment) => comment.parentComment)
  comments: Comment[];

  @ManyToOne(() => User, (user) => user.comments)
  @JoinColumn([{ name: "userUid", referencedColumnName: "uid" }])
  userU: User;
}
