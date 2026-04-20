import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import bcrypt from 'bcryptjs';
import { parseLocalAuthUsers, isLocalAuthConfigured } from '@/lib/auth/local-users';

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

if (isLocalAuthConfigured()) {
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

        const users = parseLocalAuthUsers(process.env.AUTH_LOCAL_USERS);
        const row = users.find((u) => u.username.toLowerCase() === username.toLowerCase());
        if (!row) return null;

        const ok = await bcrypt.compare(password, row.passwordHash);
        if (!ok) return null;

        return {
          id: row.username,
          name: row.username,
          email: `${row.username}@local.auth`,
          isAdmin: row.admin,
        };
      },
    })
  );
}

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
        const u = user as { isAdmin?: boolean; email?: string | null; id?: string };
        token.isAdmin = Boolean(u.isAdmin);
        token.email = u.email ?? undefined;
        token.sub = u.id ?? token.sub;
        token.authProvider = 'credentials';
        return token;
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
      if (token.authProvider !== 'credentials') {
        token.isAdmin = email ? adminEmails.has(email) : false;
      }

      return token;
    },
    async session({ session, token }) {
      session.isAdmin = Boolean(token.isAdmin);
      session.hasDriveAccess = Boolean(token.googleAccessToken);
      return session;
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
};
