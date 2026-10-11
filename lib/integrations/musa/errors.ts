export class MusaIntegrationError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "MusaIntegrationError";
  }
}

export function musaJson(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function musaErrorResponse(error: unknown): Response {
  if (error instanceof MusaIntegrationError) {
    return musaJson({ version: 1, error: { code: error.code, message: error.message } }, error.status);
  }
  // Never echo database/provider errors: they can include credentials or account details.
  return musaJson({ version: 1, error: { code: "INTERNAL_ERROR", message: "OpenReply is temporarily unavailable." } }, 500);
}
