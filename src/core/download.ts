// Offer a generated file (city export, screenshot) to the player.
// Inside the claude.ai artifact viewer, downloads started by the page itself
// are blocked, so the platform's `downloads` capability (a confirmed save) is
// used there; everywhere else a normal <a download> link.

interface DownloadsNS {
  save(r: { filename: string; data: Blob | string | ArrayBuffer | ArrayBufferView }): Promise<{ status: string }>;
}
interface ClaudeHost {
  use(name: string): Promise<unknown>;
}

let hostDownloads: Promise<DownloadsNS | null> | null = null;

function host(): ClaudeHost | null {
  const c = (window as unknown as { claude?: ClaudeHost }).claude;
  return c && typeof c.use === 'function' ? c : null;
}

/** true when running inside the claude.ai artifact viewer */
export function inArtifactViewer(): boolean {
  return host() !== null;
}

function downloads(): Promise<DownloadsNS | null> {
  const h = host();
  if (!h) return Promise.resolve(null);
  if (!hostDownloads) hostDownloads = h.use('downloads').then((ns) => (ns as DownloadsNS | null) ?? null).catch(() => null);
  return hostDownloads;
}

export type DownloadOutcome = 'saved' | 'declined' | 'failed';

/** Offer `data` as `filename`. Resolves how it went (never rejects). */
export async function offerDownload(filename: string, data: Blob): Promise<DownloadOutcome> {
  const dl = await downloads();
  if (dl) {
    try {
      await dl.save({ filename, data });
      return 'saved';
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      if (code === 'declined') return 'declined';
      console.warn('[download] host save failed', e);
      return 'failed';
    }
  }
  if (inArtifactViewer()) return 'failed';
  try {
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return 'saved';
  } catch (e) {
    console.warn('[download] browser download failed', e);
    return 'failed';
  }
}

/** data: URL → Blob */
export function dataUrlToBlob(url: string): Blob {
  const [head, body] = url.split(',', 2);
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'application/octet-stream';
  const bin = atob(body ?? '');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return new Blob([out], { type: mime });
}
