import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { isLocalAuthConfigured } from '@/lib/auth/local-users';

const PUBLIC_PATHS = ['/login', '/favicon.ico'];

export async function middleware(req: NextRequest) {
  const hasGoogleAuth = Boolean(process.env.GOOGLE_CLIENT_ID?.trim());
  const hasLocalAuth = isLocalAuthConfigured();
  if (!hasGoogleAuth && !hasLocalAuth) {
    return NextResponse.next();
  }

  const { pathname } = req.nextUrl;
  const isDriveCron =
    pathname === '/api/drive/sync' && req.nextUrl.searchParams.get('mode') === 'cron';

  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/auth') ||
    isDriveCron ||
    PUBLIC_PATHS.includes(pathname)
  ) {
    return NextResponse.next();
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('callbackUrl', req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

/**
 * Excluir todo `/_next` (static, chunks, webpack-hmr, etc.) para no tocar HMR/WebSockets
 * ni assets en dev.
 */
export const config = {
  matcher: ['/((?!_next|api/auth|favicon\\.ico).*)'],
};
