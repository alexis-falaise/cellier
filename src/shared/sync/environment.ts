/**
 * Browser facilities the engine depends on, behind an interface so tests run in Node without a DOM.
 */
export interface EngineEnvironment {
  isOnline(): boolean;
  isVisible(): boolean;
  onOnline(listener: () => void): () => void;
  onVisibilityChange(listener: (visible: boolean) => void): () => void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  /**
   * Runs `fn` while holding the named lock, or resolves `undefined` without running it when another
   * holder (another tab) has it: `navigator.locks.request(name, { ifAvailable: true }, …)`.
   */
  withLock<T>(name: string, fn: () => Promise<T>): Promise<T | undefined>;
  /** `navigator.storage.persist()`, once, best effort. */
  persistStorage(): void;
}

/** In-tab fallback when the Web Locks API is missing (single tab assumed). */
function createMemoryLocks() {
  const held = new Set<string>();
  return async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
    if (held.has(name)) return undefined;
    held.add(name);
    try {
      return await fn();
    } finally {
      held.delete(name);
    }
  };
}

export function createBrowserEnvironment(): EngineEnvironment {
  const memoryLock = createMemoryLocks();
  const hasWindow = typeof window !== 'undefined';
  const hasDocument = typeof document !== 'undefined';
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  return {
    isOnline: () => nav?.onLine ?? true,
    isVisible: () => !hasDocument || document.visibilityState === 'visible',
    onOnline(listener) {
      if (!hasWindow) return () => {};
      window.addEventListener('online', listener);
      return () => window.removeEventListener('online', listener);
    },
    onVisibilityChange(listener) {
      if (!hasDocument) return () => {};
      const handler = () => listener(document.visibilityState === 'visible');
      document.addEventListener('visibilitychange', handler);
      return () => document.removeEventListener('visibilitychange', handler);
    },
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
    async withLock(name, fn) {
      const locks = nav?.locks;
      if (!locks) return memoryLock(name, fn);
      return locks.request(name, { ifAvailable: true }, async (lock) => (lock ? fn() : undefined));
    },
    persistStorage() {
      void nav?.storage?.persist?.().catch(() => undefined);
    },
  };
}

/** Environment for tests: online, visible, no events unless fired by hand, in-memory lock. */
export interface ManualEnvironment extends EngineEnvironment {
  online: boolean;
  visible: boolean;
  fireOnline(): void;
  fireVisibility(visible: boolean): void;
}

export function createManualEnvironment(): ManualEnvironment {
  const onlineListeners = new Set<() => void>();
  const visibilityListeners = new Set<(visible: boolean) => void>();
  const env: ManualEnvironment = {
    online: true,
    visible: true,
    isOnline: () => env.online,
    isVisible: () => env.visible,
    onOnline(listener) {
      onlineListeners.add(listener);
      return () => onlineListeners.delete(listener);
    },
    onVisibilityChange(listener) {
      visibilityListeners.add(listener);
      return () => visibilityListeners.delete(listener);
    },
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
    withLock: createMemoryLocks(),
    persistStorage() {},
    fireOnline() {
      env.online = true;
      for (const l of onlineListeners) l();
    },
    fireVisibility(visible) {
      env.visible = visible;
      for (const l of visibilityListeners) l(visible);
    },
  };
  return env;
}
