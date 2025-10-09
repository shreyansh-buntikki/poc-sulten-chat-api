import { Column, Entity, OneToMany } from "typeorm";
import { Bundle } from "./Bundle";

@Entity("bundle_price", { schema: "public" })
export class BundlePrice {
  @Column("uuid", {
    primary: true,
    name: "id",
    default: () => "uuid_generate_v4()",
  })
  id: string;

  @Column("integer", { name: "price" })
  price: number;

  @Column("character varying", { name: "iosName", nullable: true })
  iosName: string | null;

  @Column("character varying", { name: "androidName", nullable: true })
  androidName: string | null;

  @Column("character varying", { name: "name", nullable: true })
  name: string | null;

  @OneToMany(() => Bundle, (bundle) => bundle.pricingDetail)
  bundles: Bundle[];
}
