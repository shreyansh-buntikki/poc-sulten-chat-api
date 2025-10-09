import { Column, Entity, Index, JoinTable, ManyToMany } from "typeorm";
import { Recipe } from "./Recipe";
import { Video } from "./Video";

@Index("IDX_8e4052373c579afc1471f52676", ["id"], {})
@Index("IDX_6a9775008add570dc3e5a0bab7", ["name"], {})
@Index("UQ_6a9775008add570dc3e5a0bab7b", ["name"], { unique: true })
@Entity("tag", { schema: "public" })
export class Tag {
  @Column("uuid", {
    primary: true,
    name: "id",
    default: () => "uuid_generate_v4()",
  })
  id: string;

  @Column("character varying", { name: "name", unique: true })
  name: string;

  @ManyToMany(() => Recipe, (recipe) => recipe.tags)
  recipes: Recipe[];

  @ManyToMany(() => Video, (video) => video.tags)
  @JoinTable({
    name: "video_tags_tag",
    joinColumns: [{ name: "tagId", referencedColumnName: "id" }],
    inverseJoinColumns: [{ name: "videoId", referencedColumnName: "id" }],
    schema: "public",
  })
  videos: Video[];
}
