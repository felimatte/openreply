import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFlowCapabilities, sendFlowMediaMessage, sendFlowTextMessage } from "@/lib/flows/media";
import { ZernioDeliveryUnconfirmedError } from "@/lib/zernio/client";

const fetchMock = vi.fn();
const zernio = { provider: "ZERNIO" as const, apiKey: "secret", accountId: "account", instagramId: "ig", operationId: "effect-1" };
const meta = { provider: "META" as const, accessToken: "secret" };
const base = { instagramAccountId: "ig", userId: "person", url: "https://assets.example.net/file.pdf", name: "Guía.pdf" };

beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe("flow message provider contracts", () => {
  it("sends PDF as a native file on Zernio and uses a durable operation key", async () => {
    fetchMock.mockImplementation(async () => Response.json({ data: { messageId: "message" } }));
    await sendFlowMediaMessage({ ...base, context: zernio, type: "pdf" });
    await sendFlowMediaMessage({ ...base, context: zernio, type: "pdf" });
    const [target, init] = fetchMock.mock.calls[0];
    expect(target).toContain("/conversations/person/messages");
    expect(JSON.parse(init.body)).toEqual({ accountId: "account", attachmentUrl: base.url, attachmentType: "file" });
    expect(init.headers["Idempotency-Key"]).toBe(fetchMock.mock.calls[1][1].headers["Idempotency-Key"]);
  });
  it("uses an explicit downloadable link for PDF on Meta", async () => {
    fetchMock.mockResolvedValue(Response.json({ message_id: "message", recipient_id: "person" }));
    await sendFlowMediaMessage({ ...base, context: meta, type: "pdf" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.message).toEqual({ text: `Guía.pdf\n${base.url}` });
    expect(getFlowCapabilities("META")).toMatchObject({ media: { pdf: false }, pdfMode: "link", initialButtons: false });
  });
  it.each(["image", "video", "audio"] as const)("sends %s with Meta's attachment payload", async (type) => {
    fetchMock.mockResolvedValue(Response.json({ message_id: "message" }));
    await sendFlowMediaMessage({ ...base, context: meta, type });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ recipient: { id: "person" }, message: { attachment: { type, payload: { url: base.url } } } });
  });
  it("treats an ambiguous upstream failure as unconfirmed without an extra send", async () => {
    fetchMock.mockResolvedValue(Response.json({ message: "secret details" }, { status: 500 }));
    await expect(sendFlowMediaMessage({ ...base, context: zernio, type: "pdf" })).rejects.toBeInstanceOf(ZernioDeliveryUnconfirmedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("keeps upstream secrets out of Meta errors", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: { code: 200, message: "access token secret" } }, { status: 400 }));
    await expect(sendFlowMediaMessage({ ...base, context: meta, type: "image" })).rejects.not.toThrow("secret");
  });
  it("uses mixed URL/postback buttons in one later message", async () => {
    fetchMock.mockResolvedValue(Response.json({ message_id: "message" }));
    await sendFlowTextMessage({ context: meta, instagramAccountId: "ig", userId: "person", text: "Elegí", buttons: [{ type: "url", title: "Ver", url: "https://example.net" }, { type: "postback", title: "Seguir", payload: "continue:run:node" }] });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).message.attachment.payload.buttons).toEqual([{ type: "web_url", title: "Ver", url: "https://example.net" }, { type: "postback", title: "Seguir", payload: "continue:run:node" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("only allows plain text in the initial private reply", async () => {
    await expect(sendFlowTextMessage({ context: zernio, instagramAccountId: "ig", userId: "person", commentId: "comment", text: "Hola", buttons: [{ type: "postback", title: "Seguir", payload: "continue" }] })).rejects.toThrow("apertura");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("sends later quick replies with the documented Zernio shape", async () => {
    fetchMock.mockResolvedValue(Response.json({ messageId: "message" }));
    await sendFlowTextMessage({ context: zernio, instagramAccountId: "ig", userId: "person", text: "¿Qué buscás?", quickReplies: [{ content_type: "text", title: "Curso", payload: "course" }] });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).quickReplies).toEqual([{ title: "Curso", payload: "course" }]);
  });
  it("counts UTF-8 bytes and rejects URLs containing credentials", async () => {
    await expect(sendFlowTextMessage({ context: meta, instagramAccountId: "ig", userId: "person", text: "🙂".repeat(251) })).rejects.toThrow("límite");
    await expect(sendFlowMediaMessage({ ...base, context: meta, type: "image", url: "https://secret:password@example.net/file.jpg" })).rejects.toThrow("HTTPS");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
