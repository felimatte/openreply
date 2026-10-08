import { createHash, randomUUID } from "node:crypto";
import { getMetaGraphApiVersion } from "@/lib/env";
import type { InstagramContext } from "@/lib/instagram/context";
import { MetaApiError, PermissionError, RateLimitError, TokenExpiredError } from "@/lib/meta/client";
import type { QuickReply } from "@/lib/meta/client";
import { zernioRequest, ZernioApiError, ZernioDeliveryUnconfirmedError } from "@/lib/zernio/client";

export type FlowMediaType = "image" | "video" | "audio" | "pdf";
export { getFlowCapabilities } from "./capabilities";

export function isFlowMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash && value.length <= 2048;
  } catch { return false; }
}

export type FlowTextButton = { type: "url"; title: string; url: string } | { type: "postback"; title: string; payload: string };

export async function sendFlowTextMessage({ context, instagramAccountId, userId, commentId, postId, text, buttons, quickReplies, initialButtonsAllowed = false }: {
  context: InstagramContext;
  instagramAccountId: string;
  userId: string;
  commentId?: string;
  postId?: string;
  text: string;
  buttons?: FlowTextButton[];
  quickReplies?: QuickReply[];
  initialButtonsAllowed?: boolean;
}): Promise<{ message_id: string; recipient_id?: string }> {
  if (!text.trim() || Buffer.byteLength(text) > 1000 || ((buttons?.length ?? 0) > 0 && text.length > 640)) throw new Error("El mensaje supera el límite permitido por Instagram.");
  if ((buttons?.length ?? 0) > 3 || (quickReplies?.length ?? 0) > 13 || (buttons?.length && quickReplies?.length)) throw new Error("Las opciones del mensaje no son válidas.");
  if (buttons?.some((button) => !button.title.trim() || button.title.length > 20 || (button.type === "url" ? !isFlowMediaUrl(button.url) : !button.payload || Buffer.byteLength(button.payload) > 1000))) throw new Error("El botón no es válido.");
  if (quickReplies?.some((reply) => reply.content_type !== "text" || !reply.title.trim() || reply.title.length > 20 || !reply.payload || Buffer.byteLength(reply.payload) > 1000)) throw new Error("La respuesta rápida no es válida.");
  if (commentId && (quickReplies?.length || (buttons?.length && (!initialButtonsAllowed || buttons.length !== 1 || buttons[0].type !== "postback")))) throw new Error("La apertura admite un botón de continuación sólo cuando Instagram confirmó el seguimiento.");
  if (context.provider === "ZERNIO") {
    const path = commentId ? `/inbox/comments/${encodeURIComponent(postId ?? commentId)}/${encodeURIComponent(commentId)}/private-reply` : `/inbox/conversations/${encodeURIComponent(userId)}/messages`;
    const body = { accountId: context.accountId, message: text, ...(buttons?.length ? { buttons } : {}), ...(quickReplies?.length ? { quickReplies: quickReplies.map(({ title, payload }) => ({ title, payload })) } : {}) };
    const idempotencyKey = createHash("sha256").update(JSON.stringify({ operationId: context.operationId ?? randomUUID(), path, body })).digest("hex");
    const result = await zernioRequest<{ messageId?: string; data?: { messageId?: string } }>({ apiKey: context.apiKey, path, method: "POST", body, ...(commentId ? {} : { idempotencyKey }) }).catch((error: unknown) => {
      if (error instanceof ZernioApiError && error.code >= 500) throw new ZernioDeliveryUnconfirmedError();
      throw error;
    });
    const messageId = result?.messageId ?? result?.data?.messageId;
    if (!messageId) throw new ZernioDeliveryUnconfirmedError();
    return { message_id: messageId, recipient_id: userId };
  }
  const message = buttons?.length ? {
    attachment: { type: "template", payload: { template_type: "button", text, buttons: buttons.map((button) => button.type === "url" ? { type: "web_url", title: button.title, url: button.url } : button) } },
  } : { text, ...(quickReplies?.length ? { quick_replies: quickReplies } : {}) };
  return sendMetaFlowMessage(context.accessToken, instagramAccountId, { recipient: commentId ? { comment_id: commentId } : { id: userId }, message }, userId);
}

async function sendMetaFlowMessage(accessToken: string, instagramAccountId: string, body: unknown, userId: string) {
  const response = await fetch(`https://graph.instagram.com/${getMetaGraphApiVersion()}/${encodeURIComponent(instagramAccountId)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(30_000),
  }).catch(() => { throw new MetaApiError(502, undefined, undefined, "No se pudo confirmar el envío del mensaje."); });
  const data = await response.json().catch(() => null) as { message_id?: string; recipient_id?: string; error?: { code?: number; error_subcode?: number; fbtrace_id?: string } } | null;
  if (!response.ok || data?.error) {
    const code = data?.error?.code ?? response.status;
    const message = `No se pudo enviar el mensaje (código ${code}).`;
    if (code === 190) throw new TokenExpiredError(message);
    if ([4, 17, 368, 613, 429].includes(code)) throw new RateLimitError(message);
    if ([10, 100, 200].includes(code)) throw new PermissionError(message);
    throw new MetaApiError(code, data?.error?.error_subcode, data?.error?.fbtrace_id, message);
  }
  if (!data?.message_id) throw new MetaApiError(502, undefined, undefined, "No se pudo confirmar el envío del mensaje.");
  return { message_id: data.message_id, recipient_id: data.recipient_id ?? userId };
}

export async function sendFlowMediaMessage({ context, instagramAccountId, userId, type, url, name }: {
  context: InstagramContext;
  instagramAccountId: string;
  userId: string;
  type: FlowMediaType;
  url: string;
  name?: string;
}): Promise<{ message_id: string; recipient_id?: string }> {
  if (!isFlowMediaUrl(url)) throw new Error("El archivo necesita una URL HTTPS pública válida.");
  if (!userId || !instagramAccountId) throw new Error("Falta el destinatario del archivo.");
  if (context.provider === "META" && type === "pdf") {
    // PDF attachment support has not been verified for the direct Meta adapter.
    return sendFlowTextMessage({ context, instagramAccountId, userId, text: `${name || "Descargar PDF"}\n${url}` });
  }
  if (context.provider === "ZERNIO") {
    const path = `/inbox/conversations/${encodeURIComponent(userId)}/messages`;
    const body = { accountId: context.accountId, attachmentUrl: url, attachmentType: type === "pdf" ? "file" : type };
    const idempotencyKey = createHash("sha256").update(JSON.stringify({ operationId: context.operationId ?? randomUUID(), path, body })).digest("hex");
    const result = await zernioRequest<{ messageId?: string; data?: { messageId?: string } }>({ apiKey: context.apiKey, path, method: "POST", body, idempotencyKey }).catch((error: unknown) => {
      if (error instanceof ZernioApiError && error.code >= 500) throw new ZernioDeliveryUnconfirmedError();
      throw error;
    });
    const messageId = result?.messageId ?? result?.data?.messageId;
    if (!messageId) throw new ZernioDeliveryUnconfirmedError();
    return { message_id: messageId, recipient_id: userId };
  }
  return sendMetaFlowMessage(context.accessToken, instagramAccountId, { recipient: { id: userId }, message: { attachment: { type, payload: { url } } } }, userId);
}
