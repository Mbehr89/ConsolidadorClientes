import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session extends DefaultSession {
    isAdmin: boolean;
    hasDriveAccess?: boolean;
    /** El usuario se eliminó o cambió su contraseña: hay que volver a ingresar. */
    revoked?: boolean;
  }

  interface User {
    isAdmin?: boolean;
    sessionVersion?: number;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    isAdmin?: boolean;
    authProvider?: 'google' | 'credentials';
    /** Versión de contraseña con que se inició la sesión (usuarios con contraseña). */
    sessionVersion?: number;
    /** Última vez que se revalidó contra la lista de usuarios. */
    checkedAt?: number;
    /** El usuario se eliminó o cambió su contraseña: la sesión ya no vale. */
    revoked?: boolean;
    googleAccessToken?: string | null;
    googleRefreshToken?: string | null;
    googleAccessTokenExpires?: number | null;
  }
}
