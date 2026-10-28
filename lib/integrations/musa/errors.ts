export class MusaIntegrationError extends Error {
  public retryAfterSeconds?: number;
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
    const response = musaJson({ version: 1, error: { code: error.code, message: error.message } }, error.status);
    if (error.status === 429) response.headers.set("Retry-After", String(error.retryAfterSeconds ?? 3600));
    return response;
  }
  // Never echo database/provider errors: they can include credentials or account details.
  return musaJson({ version: 1, error: { code: "INTERNAL_ERROR", message: "OpenReply is temporarily unavailable." } }, 500);
}
