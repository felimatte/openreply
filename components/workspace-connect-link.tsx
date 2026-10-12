"use client";

import type { AnchorHTMLAttributes } from "react";
import { useWorkspaceId } from "@/components/workspace-request-boundary";

export function WorkspaceConnectLink(props: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  const workspaceId = useWorkspaceId();
  const query = workspaceId ? `?${new URLSearchParams({ workspaceId })}` : "";
  return <a {...props} href={`/api/instagram/connect${query}`} />;
}
