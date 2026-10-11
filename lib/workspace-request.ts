/** Bind every request in a dashboard tab to the workspace that rendered that tab. */
export function createWorkspaceFetch(originalFetch: typeof fetch, workspaceId: string, origin: string): typeof fetch {
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString(), origin);
    if (url.origin !== origin) return originalFetch(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set("X-OpenReply-Workspace-Id", workspaceId);
    return originalFetch(input, { ...init, headers });
  };
}
