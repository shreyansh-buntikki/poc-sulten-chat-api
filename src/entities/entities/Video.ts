import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToMany,
  ManyToOne,
} from "typeorm";
import { User } from "./User";
import { Recipe } from "./Recipe";
import { Tag } from "./Tag";

@Index("IDX_1a2f3856250765d72e7e1636c8", ["id"], {})
@Entity("video", { schema: "public" })
export class Video {
  @Column("uuid", {
    primary: true,
    name: "id",
    default: () => "uuid_generate_v4()",
  })
  id: string;

  @Column("character varying", { name: "caption" })
  caption: string;

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

  @Column("timestamp without time zone", { name: "deletedAt", nullable: true })
  deletedAt: Date | null;

  @Column("integer", { name: "duration", nullable: true })
  duration: number | null;

  @Column("enum", {
    name: "status",
    enum: ["uploading", "processing", "failed", "published", "deleted"],
    default: () => "'uploading'",
  })
  status: "uploading" | "processing" | "failed" | "published" | "deleted";

  @ManyToOne(() => User, (user) => user.videos)
  @JoinColumn([{ name: "userUid", referencedColumnName: "uid" }])
  userU: User;

  @ManyToMany(() => Recipe, (recipe) => recipe.videos)
  recipes: Recipe[];

  @ManyToMany(() => Tag, (tag) => tag.videos)
  tags: Tag[];
}
