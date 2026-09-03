// test-setup.ts — vitest setup (WEAVE addition).
//
// Node ≥ 22 defines an experimental `localStorage` global that evaluates to
// `undefined` unless `--localstorage-file` is passed, and that getter shadows
// jsdom's implementation inside vitest — every test touching localStorage
// (clipboard, MRU, local backend) then throws "Cannot read properties of
// undefined". Provide a minimal in-memory Storage when the global is missing.

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
  getItem(key: string): string | null { return this.map.has(key) ? this.map.get(key)! : null; }
  key(index: number): string | null { return [...this.map.keys()][index] ?? null; }
  removeItem(key: string): void { this.map.delete(key); }
  setItem(key: string, value: string): void { this.map.set(key, String(value)); }
}

if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true, writable: true });
}
if (typeof globalThis.sessionStorage === 'undefined') {
  Object.defineProperty(globalThis, 'sessionStorage', { value: new MemoryStorage(), configurable: true, writable: true });
}
