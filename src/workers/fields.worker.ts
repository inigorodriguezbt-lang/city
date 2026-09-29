// Field-system worker: utilities, coverage and environment fields for one job
// at a time (see src/sim/fields/engine.ts). Output fields and the job's input
// buffers are transferred back (zero-copy) so the main thread can reuse them.
import { exposeWorker } from '../core/rpc';
import { FieldEngine } from '../sim/fields/engine';
import type { FieldJob, FieldResult } from '../sim/fields/protocol';

const engine = new FieldEngine();

exposeWorker({
  compute(job: FieldJob, ctx): FieldResult {
    const result = engine.run(job);
    const seen = new Set<ArrayBuffer>();
    const push = (b: ArrayBuffer): void => {
      if (seen.has(b)) return;
      seen.add(b);
      ctx.transfer.push(b);
    };
    for (const arr of Object.values(result.fields)) if (arr) push(arr.buffer as ArrayBuffer);
    for (const b of result.recycle) push(b);
    return result;
  },
  reset(): boolean {
    engine.reset();
    return true;
  },
});
