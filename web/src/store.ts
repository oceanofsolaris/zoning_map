// Minimal reactive store: set() merges and notifies subscribers with the changed keys.
export type Listener<S> = (state: S, changed: Set<keyof S>) => void;

export function createStore<S extends object>(initial: S) {
  let state = initial;
  const listeners = new Set<Listener<S>>();
  return {
    get: () => state,
    set(patch: Partial<S>) {
      const changed = new Set<keyof S>();
      for (const k of Object.keys(patch) as (keyof S)[]) if (state[k] !== patch[k]) changed.add(k);
      if (!changed.size) return;
      state = { ...state, ...patch };
      listeners.forEach((l) => l(state, changed));
    },
    subscribe(l: Listener<S>) { listeners.add(l); return () => listeners.delete(l); },
  };
}
