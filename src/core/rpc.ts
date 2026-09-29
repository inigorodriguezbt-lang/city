// Promise-based RPC over a Worker. Worker side: see `exposeWorker`.
// Message format: { id, method, args } -> { id, result } | { id, error } | { id, progress }

type Pending = { resolve: (v: any) => void; reject: (e: any) => void; onProgress?: (p: number, msg?: string) => void };

export class WorkerRPC {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  constructor(public readonly worker: Worker) {
    worker.onmessage = (e: MessageEvent) => {
      const { id, result, error, progress, message } = e.data ?? {};
      const p = this.pending.get(id);
      if (!p) return;
      if (progress !== undefined) {
        p.onProgress?.(progress, message);
        return;
      }
      this.pending.delete(id);
      if (error !== undefined) p.reject(new Error(error));
      else p.resolve(result);
    };
    worker.onerror = (e) => {
      console.error('[WorkerRPC] worker error', e.message);
      for (const p of this.pending.values()) p.reject(new Error(e.message || 'worker error'));
      this.pending.clear();
    };
  }

  call<T = unknown>(method: string, args: unknown, transfer: Transferable[] = [], onProgress?: (p: number, msg?: string) => void): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      this.worker.postMessage({ id, method, args }, transfer);
    });
  }

  get busy(): boolean {
    return this.pending.size > 0;
  }

  terminate(): void {
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new Error('terminated'));
    this.pending.clear();
  }
}

export type WorkerHandler = (args: any, ctx: { progress: (p: number, message?: string) => void; transfer: Transferable[] }) => unknown | Promise<unknown>;

/** Call inside a worker module to serve RPC methods. */
export function exposeWorker(handlers: Record<string, WorkerHandler>): void {
  const scope = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage: (m: unknown, t?: Transferable[]) => void };
  scope.onmessage = async (e: MessageEvent) => {
    const { id, method, args } = e.data ?? {};
    const h = handlers[method];
    if (!h) {
      scope.postMessage({ id, error: `unknown method ${method}` });
      return;
    }
    const transfer: Transferable[] = [];
    try {
      const result = await h(args, { progress: (progress, message) => scope.postMessage({ id, progress, message }), transfer });
      scope.postMessage({ id, result }, transfer);
    } catch (err) {
      scope.postMessage({ id, error: String((err as Error)?.stack ?? err) });
    }
  };
}
