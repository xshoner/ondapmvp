import { NextResponse, type NextRequest } from 'next/server';
import { dataSource } from './lib/supabase/env.ts';
import { updateSession } from './lib/supabase/proxy.ts';

export async function proxy(request: NextRequest) {
  if (dataSource() !== 'supabase') return NextResponse.next({ request });
  return updateSession(request);
}

export const config = {
  matcher: ['/admin/:path*', '/login'],
};
