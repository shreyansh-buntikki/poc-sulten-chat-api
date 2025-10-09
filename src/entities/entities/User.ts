import {
  Column,
  Entity,
  Index,
  ManyToMany,
  OneToMany,
  OneToOne,
} from "typeorm";
import { Bundle } from "./Bundle";
import { Collection } from "./Collection";
import { Comment } from "./Comment";
import { Like } from "./Like";
import { Menu } from "./Menu";
import { MenuView } from "./MenuView";
import { Notification } from "./Notification";
import { PushToken } from "./PushToken";
import { Recipe } from "./Recipe";
import { RecipeView } from "./RecipeView";
import { Subscription } from "./Subscription";
import { UserPurchase } from "./UserPurchase";
import { UserStoredIngredient } from "./UserStoredIngredient";
import { Video } from "./Video";

@Index("UQ_78a916df40e02a9deb1c4b75edb", ["username"], { unique: true })
@Entity("user", { schema: "public" })
export class User {
  @Column("character varying", { primary: true, name: "uid" })
  uid: string;

  @Column("character varying", {
    name: "username",
    nullable: true,
    unique: true,
  })
  username: string | null;

  @Column("character varying", { name: "bio", nullable: true })
  bio: string | null;

  @Column("timestamp without time zone", {
    name: "createdAt",
    default: () => "now()",
  })
  createdAt: Date;

  @Column("timestamp with time zone", {
    name: "lastSeen",
    nullable: true,
    default: () => "now()",
  })
  lastSeen: Date | null;

  @Column("character varying", { name: "name", nullable: true })
  name: string | null;

  @Column("character varying", { name: "image", nullable: true })
  image: string | null;

  @Column("timestamp with time zone", { name: "dob", nullable: true })
  dob: Date | null;

  @Column("enum", {
    name: "gender",
    nullable: true,
    enum: ["male", "female", "other"],
  })
  gender: "male" | "female" | "other" | null;

  @Column("text", { name: "messagingTokens", nullable: true })
  messagingTokens: string | null;

  @Column("boolean", {
    name: "termsAccepted",
    nullable: true,
    default: () => "true",
  })
  termsAccepted: boolean | null;

  @Column("enum", {
    name: "role",
    enum: ["admin", "vip", "team_sulten", "verified", "community"],
    default: () => "'community'",
  })
  role: "admin" | "vip" | "team_sulten" | "verified" | "community";

  @Column("character varying", {
    name: "tag",
    nullable: true,
    default: () => "'community'",
  })
  tag: string | null;

  @OneToMany(() => Bundle, (bundle) => bundle.userU)
  bundles: Bundle[];

  @OneToMany(() => Collection, (collection) => collection.userU)
  collections: Collection[];

  @OneToMany(() => Comment, (comment) => comment.userU)
  comments: Comment[];

  @OneToMany(() => Like, (like) => like.userU)
  likes: Like[];

  @OneToMany(() => Menu, (menu) => menu.userU)
  menus: Menu[];

  @OneToMany(() => MenuView, (menuView) => menuView.userU)
  menuViews: MenuView[];

  @OneToMany(() => Notification, (notification) => notification.userU)
  notifications: Notification[];

  @OneToMany(() => PushToken, (pushToken) => pushToken.userU)
  pushTokens: PushToken[];

  @OneToMany(() => Recipe, (recipe) => recipe.userU)
  recipes: Recipe[];

  @ManyToMany(() => Recipe, (recipe) => recipe.users)
  recipes2: Recipe[];

  @OneToMany(() => RecipeView, (recipeView) => recipeView.userU)
  recipeViews: RecipeView[];

  @OneToOne(() => Subscription, (subscription) => subscription.userU)
  subscription: Subscription;

  @ManyToMany(() => Recipe, (recipe) => recipe.users2)
  recipes3: Recipe[];

  @OneToMany(() => UserPurchase, (userPurchase) => userPurchase.userU)
  userPurchases: UserPurchase[];

  @OneToMany(
    () => UserStoredIngredient,
    (userStoredIngredient) => userStoredIngredient.userU
  )
  userStoredIngredients: UserStoredIngredient[];

  @OneToMany(() => Video, (video) => video.userU)
  videos: Video[];
}
