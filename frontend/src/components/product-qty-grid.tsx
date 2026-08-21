import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Product, QtyMap } from "@/lib/domain";

/** Per-product quantity inputs. `readOnly` turns it into a summary of an existing order. */
export function ProductQtyGrid({
  products,
  value,
  onChange,
  readOnly = false,
}: {
  products: Product[];
  value: QtyMap;
  onChange: (next: QtyMap) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {products.map((p) => (
        <div key={p.id} className="space-y-1.5">
          <Label htmlFor={`qty-${p.id}`} className="text-xs">
            {p.short_name}
          </Label>
          <Input
            id={`qty-${p.id}`}
            type="number"
            min={0}
            step="1"
            className="num"
            readOnly={readOnly}
            disabled={readOnly}
            value={value[p.id] ?? ""}
            onChange={(e) =>
              onChange({ ...value, [p.id]: e.target.value === "" ? 0 : Number(e.target.value) })
            }
          />
        </div>
      ))}
    </div>
  );
}
