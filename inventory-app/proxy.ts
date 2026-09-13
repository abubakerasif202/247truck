import type { NextRequest } from 'next/server';

import { updateSession } from '@/lib/supabase/proxy';

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match every path except Next internals, the web manifest, brand assets
     * and the server-to-server integration API. The integration routes carry
     * no browser session: they authenticate every request with an HMAC
     * signature (lib/integrations/adelaide-auth.ts) and must never be bounced
     * to /login.
     */
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|brand/|api/integrations/).*)',
  ],
};
