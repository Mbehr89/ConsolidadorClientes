import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session extends DefaultSession {
    isAdmin: boolean;
    hasDriveAccess?: boolean;
  }

  interface User {
    isAdmin?: boolean;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    isAdmin?: boolean;
    authProvider?: 'google' | 'credentials';
    googleAccessToken?: string | null;
    googleRefreshToken?: string | null;
    googleAccessTokenExpires?: number | null;
  }
}
