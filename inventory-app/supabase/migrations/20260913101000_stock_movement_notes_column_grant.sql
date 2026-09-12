-- 20260912132000_stock_movement_notes added inventory_movements.notes but did
-- not extend the column-level SELECT grant that keeps cost snapshots out of
-- base-table reads. Any authenticated read that named `notes` (the dashboard
-- "Recent movements" panel) was therefore rejected outright with
-- "permission denied for table inventory_movements", leaving the panel empty
-- and logging an error on every dashboard load. Notes carry no cost data, so
-- they belong with the other non-cost columns.

grant select (notes) on public.inventory_movements to authenticated;
