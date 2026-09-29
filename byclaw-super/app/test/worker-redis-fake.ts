/** Unit tests only: production Worker state always uses Redis. */
export function workerRedisFake() {
  const strings = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  const hashes = new Map<string, Map<string, string>>();
  return {
    async get(key: string) { return strings.get(key) ?? null; },
    async set(key: string, value: string, ...options: unknown[]) {
      if (options.includes("NX") && strings.has(key)) return null;
      strings.set(key, value); return "OK";
    },
    async hset(key: string, field: string, value: string) {
      const hash = hashes.get(key) ?? new Map<string, string>();
      hash.set(field, value); hashes.set(key, hash); return 1;
    },
    async hvals(key: string) { return [...(hashes.get(key)?.values() ?? [])]; },
    async hdel(key: string, field: string) { return Number(hashes.get(key)?.delete(field)); },
    async sadd(key: string, item: string) { const set = sets.get(key) ?? new Set<string>(); set.add(item); sets.set(key, set); return 1; },
    async srem(key: string, item: string) { return Number(sets.get(key)?.delete(item)); },
    async sscan(key: string) { return ["0", [...(sets.get(key) ?? [])]] as [string, string[]]; },
    async expire() { return 1; },
    async eval(script: string, count: number, ...args: Array<string | number>) {
      const key = String(args[0]);
      const token = args[count];
      if (script.includes("'XPENDING'")) return 1;
      if (strings.get(key) !== token) return 0;
      if (script.includes("'DEL'")) strings.delete(key);
      if (count === 2 && script.includes("'SET', KEYS[2]")) {
        const stateKey = String(args[1]);
        const value = String(args[count + 1]);
        const previous = strings.get(stateKey);
        if (previous && (JSON.parse(previous).afterEventId ?? 0) > (JSON.parse(value).afterEventId ?? 0)) return 0;
        strings.set(stateKey, value);
      }
      return 1;
    },
  };
}
