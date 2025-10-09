import { Column, Entity, JoinColumn, ManyToOne } from "typeorm";
import { Bundle } from "./Bundle";
import { User } from "./User";

@Entity("user_purchase", { schema: "public" })
export class UserPurchase {
  @Column("uuid", {
    primary: true,
    name: "id",
    default: () => "uuid_generate_v4()",
  })
  id: string;

  @Column("character varying", { name: "transactionId" })
  transactionId: string;

  @Column("enum", { name: "purchaseType", enum: ["iap", "web"] })
  purchaseType: "iap" | "web";

  @Column("enum", { name: "platform", enum: ["ios", "android", "web"] })
  platform: "ios" | "android" | "web";

  @Column("timestamp without time zone", {
    name: "purchasedAt",
    default: () => "now()",
  })
  purchasedAt: Date;

  @Column("bigint", { name: "purchasedAtMillis", nullable: true })
  purchasedAtMillis: string | null;

  @ManyToOne(() => Bundle, (bundle) => bundle.userPurchases)
  @JoinColumn([{ name: "bundleId", referencedColumnName: "id" }])
  bundle: Bundle;

  @ManyToOne(() => User, (user) => user.userPurchases)
  @JoinColumn([{ name: "userUid", referencedColumnName: "uid" }])
  userU: User;
}
