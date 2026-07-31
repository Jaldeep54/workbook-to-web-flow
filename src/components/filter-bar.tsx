import { useQuery } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { shopsQuery } from "@/lib/queries";

export function ShopFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data: shops = [] } = useQuery(shopsQuery);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[210px] bg-card">
        <SelectValue placeholder="All shops" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All shops</SelectItem>
        {shops.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.shop_name}
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
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const { data: shops = [] } = useQuery(shopsQuery);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {shops.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.shop_name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}