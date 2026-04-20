import type { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';

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

const authDisabled = !process.env.GOOGLE_CLIENT_ID;
const adminEmails = parseAdminEmails(process.env.ADMIN_EMAILS);

export const authOptions: NextAuthOptions = {
  providers: authDisabled
    ? []
    : [
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
        }),
      ],
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
    async signIn({ user }) {
      if (authDisabled) return true;
      const email = normalizeEmail(user.email);
      if (!email) return false;
      const ok = isAllowedDomain(email, process.env.ALLOWED_EMAIL_DOMAIN);
      if (!ok) return '/login?error=domain_not_allowed';
      return true;
    },
    async jwt({ token, account }) {
      if (account?.provider === 'google') {
        token.googleAccessToken = account.access_token;
        token.googleRefreshToken = account.refresh_token ?? token.googleRefreshToken;
        token.googleAccessTokenExpires = account.expires_at
          ? account.expires_at * 1000
          : null;
      }
      const email = normalizeEmail(token.email);
      token.isAdmin = email ? adminEmails.has(email) : false;
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
