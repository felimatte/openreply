"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { createWorkspaceFetch } from "@/lib/workspace-request";
import { setClientWorkspaceScope } from "@/lib/client-cache";

const WorkspaceRequestContext = createContext<string | null>(null);
export function useWorkspaceId() { return useContext(WorkspaceRequestContext); }

export function WorkspaceRequestBoundary({ workspaceId, userId, children }: { workspaceId: string; userId: string; children: React.ReactNode }) {
  const [readyWorkspace, setReadyWorkspace] = useState<string | null>(null);
  useEffect(() => {
    const originalFetch = window.fetch;
    const scopedFetch = createWorkspaceFetch(originalFetch.bind(window), workspaceId, window.location.origin);
    window.fetch = scopedFetch;
    const restoreStorageScope = setClientWorkspaceScope(userId, workspaceId);
    // Children mount only after request scoping is installed, including their first effects.
    const timer = window.setTimeout(() => setReadyWorkspace(workspaceId), 0);
    return () => {
      window.clearTimeout(timer);
      if (window.fetch === scopedFetch) window.fetch = originalFetch;
      restoreStorageScope();
    };
  }, [workspaceId, userId]);
  if (readyWorkspace !== workspaceId) return <div className="min-h-screen bg-background" aria-busy="true" />;
  return <WorkspaceRequestContext.Provider value={workspaceId}>{children}</WorkspaceRequestContext.Provider>;
}
