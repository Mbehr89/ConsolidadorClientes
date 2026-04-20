const LS_KEY = 'alias-candidate-ignores';

/** Pares sugeridos que el usuario ignoró en Admin (solo cliente). */
export function loadIgnoredPairKeys(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

export function saveIgnoredPairKeys(set: ReadonlySet<string>): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LS_KEY, JSON.stringify([...set]));
}

export function addIgnoredPairKey(key: string): void {
  const s = loadIgnoredPairKeys();
  s.add(key);
  saveIgnoredPairKeys(s);
}
