import { NextResponse, type NextRequest } from 'next/server';

import { createServerSupabaseClient } from '@/lib/supabase/server';

async function signOutAndRedirect(request: NextRequest): Promise<NextResponse> {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(`${request.nextUrl.origin}/login`);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return signOutAndRedirect(request);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return signOutAndRedirect(request);
}
