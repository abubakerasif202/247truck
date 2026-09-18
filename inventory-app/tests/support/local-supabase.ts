/** Fail closed before destructive fixtures create any Supabase client. */
export function requireLocalSupabase(url: string | undefined): void {
  let target: URL;
  try {
    target = new URL(url ?? '');
  } catch {
    throw new Error('LOCAL_SUPABASE_REQUIRED');
  }
  if (
    target.protocol !== 'http:' ||
    !['localhost', '127.0.0.1'].includes(target.hostname) ||
    target.port !== '55331' ||
    target.username || target.password ||
    target.pathname !== '/' || target.search || target.hash
  ) {
    throw new Error('LOCAL_SUPABASE_REQUIRED');
  }
  if (process.env.SUPABASE_TEST_ALLOW_DESTRUCTIVE !== 'true') {
    throw new Error('Set SUPABASE_TEST_ALLOW_DESTRUCTIVE=true for disposable local tests.');
  }
}
