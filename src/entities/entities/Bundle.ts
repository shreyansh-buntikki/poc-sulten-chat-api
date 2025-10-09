import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from "typeorm";
import { BundlePrice } from "./BundlePrice";
import { User } from "./User";
import { BundleRecipe } from "./BundleRecipe";
import { UserPurchase } from "./UserPurchase";

@Entity("bundle", { schema: "public" })
export class Bundle {
  @Column("uuid", {
    primary: true,
    name: "id",
    default: () => "uuid_generate_v4()",
  })
  id: string;

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

  @Column("character varying", { name: "name" })
  name: string;

  @Column("text", { name: "ingress" })
  ingress: string;

  @Column("boolean", { name: "isActive", default: () => "false" })
  isActive: boolean;

  @Column("character varying", { name: "image", nullable: true })
  image: string | null;

  @Column("timestamp without time zone", { name: "deletedAt", nullable: true })
  deletedAt: Date | null;

  @ManyToOne(() => BundlePrice, (bundlePrice) => bundlePrice.bundles)
  @JoinColumn([{ name: "pricingDetailId", referencedColumnName: "id" }])
  pricingDetail: BundlePrice;

  @ManyToOne(() => User, (user) => user.bundles)
  @JoinColumn([{ name: "userUid", referencedColumnName: "uid" }])
  userU: User;

  @OneToMany(() => BundleRecipe, (bundleRecipe) => bundleRecipe.bundle)
  bundleRecipes: BundleRecipe[];

  @OneToMany(() => UserPurchase, (userPurchase) => userPurchase.bundle)
  userPurchases: UserPurchase[];
}
