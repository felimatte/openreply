/**
 * Tiny stale-while-revalidate cache backed by sessionStorage.
 *
 * Instagram API calls (profile picture, the post library) are slow, so we show
 * the last cached copy instantly and refresh in the background. Cache lives for
 * the browser tab session; entries older than the caller's max age are treated
 * as stale (still shown, but the caller should revalidate).
 */

interface Entry<T> {
  data: T;
  ts: number;
}

// Set only by the mounted browser dashboard boundary, before its children mount.
let workspaceStorageScope = "unselected";

export function setClientWorkspaceScope(userId: string, workspaceId: string): () => void {
  const previous = workspaceStorageScope;
  workspaceStorageScope = `${encodeURIComponent(userId)}:${encodeURIComponent(workspaceId)}`;
  return () => { workspaceStorageScope = previous; };
}

export function getWorkspaceStorageKey(key: string): string {
  return `openreply:v1:${workspaceStorageScope}:${key}`;
}

export function readCache<T>(
  key: string,
  maxAgeMs: number
): { data: T | null; stale: boolean } {
  if (typeof window === "undefined") return { data: null, stale: true };
  try {
    const raw = window.sessionStorage.getItem(getWorkspaceStorageKey(key));
    if (!raw) return { data: null, stale: true };
    const entry = JSON.parse(raw) as Entry<T>;
    return { data: entry.data, stale: Date.now() - entry.ts > maxAgeMs };
  } catch {
    return { data: null, stale: true };
  }
}

export function writeCache<T>(key: string, data: T): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      getWorkspaceStorageKey(key),
      JSON.stringify({ data, ts: Date.now() })
    );
  } catch {
    // Storage full or unavailable — caching is best-effort.
  }
}
