import { createFileRoute } from "@tanstack/react-router";

import { DeliverySheetPage } from "@/components/delivery-sheet-page";
import { RequirePermission } from "@/components/require-permission";
import { RESOURCES } from "@/hooks/usePermissions";

export const Route = createFileRoute("/_authenticated/delivery-sheet")({
  component: () => (
    <RequirePermission resource={RESOURCES.orders}>
      <DeliverySheetPage />
    </RequirePermission>
  ),
});
