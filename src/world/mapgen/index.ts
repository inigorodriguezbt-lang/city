// ─────────────────────────────────────────────────────────────────────────────
// Map generator entry point. Public API is FROZEN: generateMap(settings,
// onProgress) → GeneratedMap.
//
// The heavy work runs in a dedicated Web Worker (inlined so the single-file
// build works); progress labels are streamed back ("Shaping continents",
// "Eroding mountains", "Carving rivers", …), typed arrays are transferred (no
// copies) and the worker is terminated afterwards. Output is deterministic for
// the same settings + seed. If workers are unavailable or fail to start (very
// old browsers, restrictive CSP on blob: workers) the same pipeline runs on
// the main thread and produces the identical map.
// ─────────────────────────────────────────────────────────────────────────────
import type { GeneratedMap, MapSettings } from '../../core/types';
import { WorkerRPC } from '../../core/rpc';
import MapgenWorker from '../../workers/mapgen.worker?worker&inline';

/** Generate a map in a Web Worker. onProgress(0..1, label). */
export async function generateMap(settings: MapSettings, onProgress?: (p: number, label: string) => void): Promise<GeneratedMap> {
  // structured-clone-safe copy of the settings (strip anything non-plain)
  const args: MapSettings = JSON.parse(JSON.stringify(settings));
  let rpc: WorkerRPC | null = null;
  try {
    rpc = new WorkerRPC(new MapgenWorker());
  } catch (err) {
    console.warn('[mapgen] worker unavailable, generating on the main thread', err);
  }
  if (rpc) {
    let started = false;
    try {
      return await rpc.call<GeneratedMap>('generate', args, [], (p, msg) => {
        started = true;
        onProgress?.(p, msg ?? '');
      });
    } catch (err) {
      // a worker that never reported progress failed to load (CSP, blob URLs
      // blocked…): fall back below. Errors from inside the pipeline propagate.
      if (started) throw err;
      console.warn('[mapgen] worker failed to start, generating on the main thread', err);
    } finally {
      rpc.terminate();
    }
  }
  const { runPipeline } = await import('./pipeline');
  // yield once so the loading screen can paint before the synchronous run
  await new Promise((r) => setTimeout(r, 0));
  return runPipeline(args, onProgress);
}
