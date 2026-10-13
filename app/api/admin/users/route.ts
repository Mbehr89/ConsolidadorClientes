import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/require-admin';
import { hashPassword, loadUsers, mutateUsers } from '@/lib/auth/user-store';
import {
  UserRuleError,
  addUser,
  removeUser,
  toPublicUser,
  updateUser,
  validatePassword,
  type AppUser,
} from '@/lib/auth/users';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function listResponse(users: readonly AppUser[], source: 'store' | 'env', me: string | null) {
  return NextResponse.json({
    users: users.map(toPublicUser).sort((a, b) => a.username.localeCompare(b.username, 'es')),
    source,
    me,
  });
}

function errorResponse(err: unknown) {
  if (err instanceof UserRuleError) return NextResponse.json({ error: err.message }, { status: 400 });
  if (err instanceof z.ZodError) return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 });
  console.error('[admin.users] failed', err);
  return NextResponse.json({ error: 'No se pudo guardar el cambio.' }, { status: 500 });
}

export async function GET() {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  const { users, source } = await loadUsers();
  return listResponse(users, source, auth.actor.username);
}

const CreateBody = z.object({
  username: z.string(),
  password: z.string(),
  admin: z.boolean(),
});

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    const body = CreateBody.parse(await req.json());
    validatePassword(body.password);
    const passwordHash = await hashPassword(body.password);
    const now = new Date().toISOString();
    const users = await mutateUsers((current) =>
      addUser(current, { username: body.username, passwordHash, admin: body.admin }, auth.actor.label, now)
    );
    return listResponse(users, 'store', auth.actor.username);
  } catch (err) {
    return errorResponse(err);
  }
}

const UpdateBody = z.object({
  username: z.string().min(1),
  password: z.string().optional(),
  admin: z.boolean().optional(),
});

export async function PATCH(req: Request) {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    const body = UpdateBody.parse(await req.json());
    if (body.password != null) validatePassword(body.password);
    const passwordHash = body.password != null ? await hashPassword(body.password) : undefined;
    const now = new Date().toISOString();
    const users = await mutateUsers((current) =>
      updateUser(current, body.username, { passwordHash, admin: body.admin }, auth.actor.username, now)
    );
    return listResponse(users, 'store', auth.actor.username);
  } catch (err) {
    return errorResponse(err);
  }
}

const DeleteBody = z.object({ username: z.string().min(1) });

export async function DELETE(req: Request) {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    const body = DeleteBody.parse(await req.json());
    const users = await mutateUsers((current) => removeUser(current, body.username, auth.actor.username));
    return listResponse(users, 'store', auth.actor.username);
  } catch (err) {
    return errorResponse(err);
  }
}
