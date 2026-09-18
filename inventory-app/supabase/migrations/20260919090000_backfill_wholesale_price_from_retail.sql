-- 20260914120000_retail_wholesale_pricing_walkin_regency_defaults.sql introduced
-- wholesale_price_incl_gst as a new nullable column and backfilled
-- retail_price_incl_gst from the legacy selling_price_incl_gst, but left
-- wholesale_price_incl_gst null for every pre-existing product. The same
-- migration also flipped every existing business customer's pricing_tier to
-- 'wholesale'. Net effect: any quote/job line for a business customer against
-- a product that predates this feature now resolves a null sale price
-- (private.product_sale_price), so the quote is stuck PRICE_PENDING and
-- cannot be sent -- a silent regression against every business customer who
-- could be quoted successfully before this feature shipped, with no
-- transition path or staff notification.
--
-- This is a one-time, additive, idempotent backfill: it only touches rows
-- that have never had a wholesale price set (wholesale_price_incl_gst is
-- null), so it cannot overwrite a wholesale price staff have already
-- configured via set_product_prices/create_product_with_prices. It restores
-- the pre-migration behavior (one price for every customer) as the default,
-- not a new discount policy; staff remain free to set a distinct wholesale
-- price per product at any time.
update public.products
set wholesale_price_incl_gst = coalesce(retail_price_incl_gst, selling_price_incl_gst)
where wholesale_price_incl_gst is null
  and coalesce(retail_price_incl_gst, selling_price_incl_gst) is not null;
