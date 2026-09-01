create index submission_rate_limits_window_started_idx
  on public.submission_rate_limits (window_started_at);
