export type SaveStatus = "saved" | "pending" | "saving" | "error";

export interface NoteDraftPatch {
  title?: string;
  contentHtml?: string;
}

export class NoteSaveQueue {
  private readonly pending = new Map<string, NoteDraftPatch>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly running = new Map<string, Promise<boolean>>();

  constructor(
    private readonly write: (id: string, patch: NoteDraftPatch) => Promise<void>,
    private readonly report: (status: SaveStatus, error?: unknown) => void,
    private readonly delayMs = 400,
  ) {}

  schedule(id: string, patch: NoteDraftPatch): void {
    this.pending.set(id, { ...this.pending.get(id), ...patch });
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.report("pending");
    this.timers.set(
      id,
      setTimeout(() => void this.flush(id), this.delayMs),
    );
  }

  async flush(id: string): Promise<boolean> {
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
    const activeWrite = this.running.get(id);
    if (activeWrite) {
      const saved = await activeWrite;
      return saved && (this.pending.has(id) ? this.flush(id) : true);
    }

    const patch = this.pending.get(id);
    if (patch === undefined) return true;
    this.pending.delete(id);
    this.report("saving");
    const operation = (async () => {
      try {
        await this.write(id, patch);
        this.report(this.pending.size ? "pending" : "saved");
        return true;
      } catch (error) {
        this.pending.set(id, { ...patch, ...this.pending.get(id) });
        this.report("error", error);
        return false;
      }
    })();
    this.running.set(id, operation);
    const saved = await operation;
    if (this.running.get(id) === operation) this.running.delete(id);
    return saved;
  }

  async flushAll(): Promise<boolean> {
    const ids = [...new Set([...this.pending.keys(), ...this.running.keys()])];
    const results = await Promise.all(ids.map((id) => this.flush(id)));
    return results.every(Boolean);
  }

  currentHtml(id: string, fallback: string): string {
    return this.pending.get(id)?.contentHtml ?? fallback;
  }

  currentTitle(id: string, fallback: string): string {
    return this.pending.get(id)?.title ?? fallback;
  }

  cancel(id: string): void {
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
    this.pending.delete(id);
    this.report(this.pending.size ? "pending" : "saved");
  }
}
