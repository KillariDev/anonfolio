type Clock = {
  now: () => number;
  schedule: (callback: () => void, delay: number) => () => void;
};
const clock: Clock = {
  now: () => Date.now(),
  schedule(callback, delay) {
    const timer = setTimeout(callback, delay);
    return () => clearTimeout(timer);
  },
};
export const retryDelay = (attempt: number) => Math.min(2000 * 2 ** Math.min(Math.max(0, attempt - 1), 5), 60_000);

export class RetryQueue<Key> {
  private pending = new Map<Key, { attempt: number; dueAt?: number; cancel?: () => void }>();
  private attempts = new Map<Key, number>();
  private paused = false;
  constructor(
    private run: (key: Key) => void | Promise<void>,
    private online: () => boolean,
    private changed: () => void,
    private time: Clock = clock,
    private delayFor: (attempt: number, key: Key) => number = retryDelay,
  ) {}
  info(key: Key) { return this.pending.get(key); }
  schedule(key: Key) {
    if (this.pending.has(key)) return;
    const attempt = (this.attempts.get(key) || 0) + 1;
    this.attempts.set(key, attempt);
    const entry: { attempt: number; dueAt?: number; cancel?: () => void } = { attempt };
    this.pending.set(key, entry);
    if (!this.paused && this.online()) {
      const delay = this.delayFor(attempt, key);
      entry.dueAt = this.time.now() + delay;
      entry.cancel = this.time.schedule(() => this.fire(key), delay);
    }
    this.changed();
  }
  // Beginning an automatic attempt keeps the backoff history.
  begin(key: Key) {
    this.pending.get(key)?.cancel?.();
    this.pending.delete(key);
  }
  cancel(key: Key) {
    this.begin(key);
    this.attempts.delete(key);
  }
  pause() {
    this.paused = true;
    for (const entry of this.pending.values()) {
      entry.cancel?.();
      entry.cancel = undefined;
      entry.dueAt = undefined;
    }
    this.changed();
  }
  resume() {
    this.paused = false;
    if (!this.online()) return;
    for (const key of [...this.pending.keys()]) {
      this.pending.get(key)?.cancel?.();
      this.fire(key);
    }
  }
  private fire(key: Key) {
    if (!this.pending.has(key)) return;
    if (this.paused || !this.online()) {
      const entry = this.pending.get(key)!;
      entry.cancel = undefined;
      entry.dueAt = undefined;
      this.changed();
      return;
    }
    this.pending.delete(key);
    this.changed();
    void Promise.resolve().then(() => this.run(key)).catch(() => this.schedule(key));
  }
}
