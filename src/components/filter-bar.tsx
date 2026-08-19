import { useQuery } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { shopAreasQuery, shopsQuery } from "@/lib/queries";

/** Pass `areaId` to cascade the shop list down to one Shop Area (from ShopAreaFilter). */
export function ShopFilter({
  value,
  onChange,
  areaId,
}: {
  value: string;
  onChange: (v: string) => void;
  areaId?: string | null;
}) {
  const { data: allShops = [] } = useQuery(shopsQuery);
  const shops = areaId ? allShops.filter((s) => s.area_id === areaId) : allShops;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[210px] bg-card">
        <SelectValue placeholder="All shops" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All shops</SelectItem>
        {shops.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {shopLabel(s.shop_name, s.label_name)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ShopSelect({
  value,
  onChange,
  placeholder = "Select shop",
  areaId,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  areaId?: string | null;
}) {
  const { data: allShops = [] } = useQuery(shopsQuery);
  const shops = areaId ? allShops.filter((s) => s.area_id === areaId) : allShops;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {shops.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {shopLabel(s.shop_name, s.label_name)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Shops are always listed with their label name, as on the printed sheets. */
export function shopLabel(shopName: string, labelName?: string | null) {
  return labelName && labelName !== shopName ? `${shopName} · ${labelName}` : shopName;
}

/**
 * Shared "Shop Area" filter — same "All Areas" + area list everywhere
 * (Shops Map, SKU Opportunity, Orders, Delivery Sheet, Deliveries, Payments)
 * so every page reads areas from the same shopAreasQuery.
 */
export function ShopAreaFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const { data: areas = [] } = useQuery(shopAreasQuery);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[180px] bg-card">
        <SelectValue placeholder="All areas" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All areas</SelectItem>
        {areas.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            {a.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
