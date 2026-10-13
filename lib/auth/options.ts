import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import { getUser, verifyCredentials } from '@/lib/auth/user-store';

/** Cada cuánto una sesión con usuario y contraseña se revalida contra la lista de usuarios. */
const CREDENTIALS_RECHECK_MS = 60_000;

function normalizeEmail(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase();
}

function parseAdminEmails(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((x) => normalizeEmail(x))
      .filter(Boolean)
  );
}

function isAllowedDomain(email: string, domainRaw: string | undefined): boolean {
  const domain = (domainRaw ?? '').trim().toLowerCase();
  if (!domain) return true;
  return email.endsWith(`@${domain}`);
}

const hasGoogleAuth = Boolean(process.env.GOOGLE_CLIENT_ID?.trim());
const adminEmails = parseAdminEmails(process.env.ADMIN_EMAILS);

const providers: NextAuthOptions['providers'] = [];

if (hasGoogleAuth) {
  providers.push(
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      authorization: {
        params: {
          scope:
            'openid email profile https://www.googleapis.com/auth/drive.readonly',
          prompt: 'consent',
          access_type: 'offline',
        },
      },
    })
  );
}

providers.push(
  CredentialsProvider({
    name: 'credentials',
    credentials: {
      username: { label: 'Usuario', type: 'text' },
      password: { label: 'Contraseña', type: 'password' },
    },
    async authorize(credentials) {
      const username = credentials?.username?.trim();
      const password = credentials?.password ?? '';
      if (!username || !password) return null;

      const row = await verifyCredentials(username, password);
      if (!row) return null;

      return {
        id: row.username,
        name: row.username,
        email: `${row.username}@local.auth`,
        isAdmin: row.admin,
        sessionVersion: row.session_version,
      };
    },
  })
);

export const authOptions: NextAuthOptions = {
  providers,
  session: {
    strategy: 'jwt',
  },
  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === 'production'
          ? '__Secure-next-auth.session-token'
          : 'next-auth.session-token',
      options: {
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
  },
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === 'credentials') {
        return true;
      }
      if (!hasGoogleAuth) {
        return true;
      }
      const email = normalizeEmail(user.email);
      if (!email) return false;
      const ok = isAllowedDomain(email, process.env.ALLOWED_EMAIL_DOMAIN);
      if (!ok) return '/login?error=domain_not_allowed';
      return true;
    },
    async jwt({ token, user, account }) {
      if (account?.provider === 'credentials' && user) {
        token.isAdmin = Boolean(user.isAdmin);
        token.email = user.email ?? undefined;
        token.sub = user.id ?? token.sub;
        token.authProvider = 'credentials';
        token.sessionVersion = user.sessionVersion ?? 0;
        token.checkedAt = Date.now();
        token.revoked = false;
        return token;
      }

      if (token.authProvider === 'credentials') {
        if (token.revoked || !token.sub) return { ...token, revoked: true, isAdmin: false };
        if (Date.now() - (token.checkedAt ?? 0) < CREDENTIALS_RECHECK_MS) return token;
        const current = await getUser(token.sub).catch(() => undefined);
        if (!current || current.session_version !== (token.sessionVersion ?? 0)) {
          return { ...token, revoked: true, isAdmin: false };
        }
        return { ...token, isAdmin: current.admin, checkedAt: Date.now() };
      }

      if (account?.provider === 'google') {
        token.googleAccessToken = account.access_token;
        token.googleRefreshToken = account.refresh_token ?? token.googleRefreshToken;
        token.googleAccessTokenExpires = account.expires_at
          ? account.expires_at * 1000
          : null;
        token.authProvider = 'google';
      }

      const email = normalizeEmail(token.email);
      token.isAdmin = email ? adminEmails.has(email) : false;
      return token;
    },
    async session({ session, token }) {
      session.isAdmin = Boolean(token.isAdmin);
      session.revoked = Boolean(token.revoked);
      session.hasDriveAccess = Boolean(token.googleAccessToken);
      return session;
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
};
