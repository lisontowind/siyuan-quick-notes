export class SerialQueue {
  private tails = new Map<string, Promise<unknown>>();
  run<T>(key: string, job: () => Promise<T>): Promise<T> {
    const next = (this.tails.get(key) ?? Promise.resolve()).catch(() => {}).then(job);
    this.tails.set(key, next);
    void next.finally(() => { if (this.tails.get(key) === next) this.tails.delete(key); }).catch(() => {});
    return next;
  }
}
export class TriggerGate {
  private last = -Infinity;
  accept(now = Date.now()): boolean {
    if (now - this.last < 500) return false;
    this.last = now;
    return true;
  }
}
