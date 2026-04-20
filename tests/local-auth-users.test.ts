import { describe, expect, it } from 'vitest';
import { parseLocalAuthUsers } from '@/lib/auth/local-users';

describe('parseLocalAuthUsers', () => {
  it('parses valid JSON', () => {
    const raw = JSON.stringify([
      { username: 'a', passwordHash: '$2a$10$abcdefghijklmnopqrstuv', admin: true },
      { username: 'b', passwordHash: '$2a$10$abcdefghijklmnopqrstuv', admin: false },
    ]);
    const out = parseLocalAuthUsers(raw);
    expect(out).toHaveLength(2);
    expect(out[0]?.username).toBe('a');
    expect(out[0]?.admin).toBe(true);
    expect(out[1]?.admin).toBe(false);
  });

  it('returns empty on invalid', () => {
    expect(parseLocalAuthUsers('')).toEqual([]);
    expect(parseLocalAuthUsers('not json')).toEqual([]);
  });
});
