import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { MusaIntegrationError, musaJson } from "./errors";

export async function requireSchedulerWorkspace(request: Request, write = false) {
  const user = await getCurrentWorkspaceContext();
  if (!user) throw new MusaIntegrationError(401, "UNAUTHORIZED", "Iniciá sesión para continuar.");
  if (!canManageWorkspace(user.role)) throw new MusaIntegrationError(403, "ADMIN_REQUIRED", "Necesitás permisos de administrador.");
  if (write && request.headers.get("origin") !== new URL(request.url).origin)
    throw new MusaIntegrationError(403, "INVALID_ORIGIN", "Volvé a abrir OpenReply y reintentá.");
  return user;
}

export function schedulerErrorResponse(error: unknown) {
  const safe = error instanceof MusaIntegrationError ? error
    : new MusaIntegrationError(503, "MUSA_UNAVAILABLE", "No pudimos verificar la programación en MUSA.");
  return musaJson({ success: false, code: safe.code, error: safe.message }, safe.status);
}
