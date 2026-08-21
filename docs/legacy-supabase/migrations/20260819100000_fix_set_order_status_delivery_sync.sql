-- Bug fix: set_order_status()'s non-Delivered branch updated orders.status
-- but never touched the surviving deliveries row's own status column (the
-- row is only deleted when there's no Received payment yet for the order —
-- when a Received payment already exists, the row is kept on purpose, but
-- its status silently stayed "Delivered" forever). That's what made the
-- Shop Detail page's Deliveries tab status <Select> appear to "not update" —
-- the UI was refetching fine, the underlying delivery record just genuinely
-- still said Delivered. Keep deliveries.status in sync with orders.status
-- whenever the row survives (harmless no-op update when it was deleted, or
-- when a new Delivered->set_order_delivered path already handles this).
CREATE OR REPLACE FUNCTION public.set_order_status(p_order_id uuid, p_status text, p_delivery_date date DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE v_date date;
BEGIN
  IF p_status NOT IN ('Pending', 'Delivered', 'Cancelled') THEN
    RAISE EXCEPTION 'Invalid status %', p_status;
  END IF;

  IF p_status = 'Delivered' THEN
    SELECT COALESCE(p_delivery_date, delivery_date, order_date, CURRENT_DATE)
      INTO v_date FROM orders WHERE id = p_order_id;
    PERFORM set_order_delivered(p_order_id, v_date);
  ELSE
    DELETE FROM payments WHERE order_id = p_order_id AND status <> 'Received';
    DELETE FROM deliveries WHERE order_id = p_order_id
      AND NOT EXISTS (SELECT 1 FROM payments pm WHERE pm.order_id = p_order_id AND pm.status = 'Received');
    UPDATE deliveries SET status = p_status, updated_at = now() WHERE order_id = p_order_id;
    UPDATE orders SET status = p_status, updated_at = now() WHERE id = p_order_id;
  END IF;
END;
$$;
