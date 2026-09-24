-- Trigger-only SECURITY DEFINER helpers must not be directly callable by API roles.
-- PostgreSQL still invokes trigger functions normally; EXECUTE is not checked at trigger fire time.
revoke all on function private.finance_payment_reversal_guard() from public, anon, authenticated, service_role;
revoke all on function private.quote_line_pricing_tier() from public, anon, authenticated, service_role;
revoke all on function private.job_line_pricing_tier() from public, anon, authenticated, service_role;
