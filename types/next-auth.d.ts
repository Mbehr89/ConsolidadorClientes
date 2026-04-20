import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session extends DefaultSession {
    isAdmin: boolean;
    hasDriveAccess?: boolean;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    isAdmin?: boolean;
    googleAccessToken?: string | null;
    googleRefreshToken?: string | null;
    googleAccessTokenExpires?: number | null;
  }
}
