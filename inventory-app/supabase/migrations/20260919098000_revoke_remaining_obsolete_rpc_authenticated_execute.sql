-- Completes 20260919093000_revoke_superseded_rpc_authenticated_execute.sql's
-- deferred follow-up: revokes authenticated EXECUTE on the remaining ten
-- superseded functions. Each has zero callers in app/ or lib/, and each has
-- a distinctly-named, differently-shaped successor the application actually
-- calls instead (see the table below). None needs a grant to service_role:
-- every one of these functions resolves its actor via auth.uid() internally
-- (private.finance_guard / private.app_is_admin / etc.), which is null under
-- a service-role JWT, so service_role could never successfully call any of
-- them either way -- granting it there would be a no-op, not a usable
-- escape hatch (proven empirically in the prior migration's own history).
--
-- Five of these ten are also internal implementation details of their own
-- successor or of another currently-active function -- NOT dead code by
-- that measure -- but every caller is itself SECURITY DEFINER, so Postgres
-- evaluates the nested call under the owning role (this migration's own
-- role, which always has implicit EXECUTE on functions it owns), never
-- under the original external caller's role. Revoking authenticated's
-- EXECUTE does not affect these internal call paths at all:
--
--   update_invoice_draft       <- called by update_invoice_draft_v2
--   post_inventory_movement    <- called by complete_job, create_job,
--                                  and other core sale/job/receiving paths
--   create_product             <- called by create_product_with_prices and
--                                  import_opening_stock_row
--   create_purchase_order      <- called by create_purchase_order_draft
--   set_product_selling_price  <- called by apply_owner_price_batch_row
--
-- The other five have no internal caller at all and are simply dead:
-- create_manual_invoice, invoice_summary, customer_receivables,
-- begin_invoice_email_send, claim_invoice_email_send.
--
--   create_manual_invoice          -> create_manual_invoice_v2
--   update_invoice_draft           -> update_invoice_draft_v2
--   invoice_summary                -> invoice_summary_v2
--   customer_receivables           -> customer_receivables_v2
--   post_inventory_movement        -> post_inventory_movement_with_notes
--   create_product                 -> create_product_with_prices
--   create_purchase_order          -> create_purchase_order_draft
--   set_product_selling_price      -> set_product_prices
--   begin_invoice_email_send       -> prepare_invoice_email_send
--   claim_invoice_email_send       -> prepare_invoice_email_send
revoke execute on function
  public.create_manual_invoice(uuid,uuid,jsonb),
  public.update_invoice_draft(uuid,uuid,integer,jsonb),
  public.invoice_summary(uuid,text,text,timestamptz,integer),
  public.customer_receivables(uuid,uuid,text,text,date,date,date,uuid,integer),
  public.post_inventory_movement(uuid,uuid,uuid,integer,text,text,numeric,uuid,text,text,text),
  public.create_product(text,text,numeric,text,text,text,text,text,text,text,text),
  public.create_purchase_order(uuid,uuid,text,text),
  public.set_product_selling_price(uuid,numeric),
  public.begin_invoice_email_send(uuid,uuid,text,text),
  public.claim_invoice_email_send(uuid,text)
from public, anon, authenticated, service_role;
