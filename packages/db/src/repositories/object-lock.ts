export class ObjectLockManager {
  private readonly locks = new Map<string, Promise<void>>();

  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = previous.then(() => current);
    this.locks.set(key, chained);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === chained) {
        this.locks.delete(key);
      }
    }
  }

  async withLocks<T>(keys: readonly string[], fn: () => Promise<T>): Promise<T> {
    const uniqueKeys = [...new Set(keys)].sort();
    const lockNext = (index: number): Promise<T> =>
      index >= uniqueKeys.length ? fn() : this.withLock(uniqueKeys[index]!, () => lockNext(index + 1));
    return lockNext(0);
  }
}
