import type { NextRequest } from 'next/server';

import { updateSession } from '@/lib/supabase/proxy';

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match every path except Next internals, the web manifest, and brand
     * assets so auth redirects never block static resources.
     */
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|brand/).*)',
  ],
};
