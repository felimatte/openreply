import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { lookupMock, requestMock } = vi.hoisted(() => ({ lookupMock: vi.fn(), requestMock: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));
vi.mock("node:https", () => ({ request: requestMock }));
import { executeFlowHttpAction, isPublicFlowIp, validateFlowHttpUrl } from "@/lib/flows/http-action";

const target = { url: "https://hooks.example.net/receive", payload: { contact: "person" }, idempotencyKey: "effect:1" };

function mockResponse(status = 200, responseBody = "ok", contentLength?: number) {
  requestMock.mockImplementation((_url, _options, callback) => {
    const req = new EventEmitter() as EventEmitter & { end: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };
    req.destroy = vi.fn((error) => { queueMicrotask(() => { if (error) req.emit("error", error); req.emit("close"); }); return req; });
    req.end = vi.fn(() => queueMicrotask(() => {
      const res = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string>; destroy: ReturnType<typeof vi.fn> };
      res.statusCode = status;
      res.headers = contentLength ? { "content-length": String(contentLength) } : {};
      res.destroy = vi.fn();
      callback(res);
      if (res.destroy.mock.calls.length) return;
      res.emit("data", Buffer.from(responseBody));
      if (res.destroy.mock.calls.length) return;
      res.emit("end"); req.emit("close");
    }));
    return req;
  });
}

beforeEach(() => { vi.clearAllMocks(); lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]); mockResponse(); });
afterEach(() => vi.useRealTimers());

describe("bounded public HTTPS flow actions", () => {
  it.each(["https://127.0.0.1/path", "https://2130706433/path", "https://0x7f000001/path", "https://[::ffff:127.0.0.1]/", "https://[fe80::1]/", "https://10.2.3.4", "https://100.64.0.1", "https://192.168.0.1", "https://service.internal", "https://localhost", "https://user:secret@public.example.net", "http://public.example.net", "https://public.example.net:8443"])("rejects unsafe destination %s before sending", async (url) => {
    expect(validateFlowHttpUrl(url)).toBe(false);
    await expect(executeFlowHttpAction({ ...target, url })).rejects.toMatchObject({ code: "INVALID_URL" });
    expect(requestMock).not.toHaveBeenCalled();
  });
  it("rejects any private address returned by DNS", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }, { address: "169.254.169.254", family: 4 }]);
    await expect(executeFlowHttpAction(target)).rejects.toMatchObject({ code: "PRIVATE_DESTINATION" });
    expect(requestMock).not.toHaveBeenCalled();
  });
  it("pins the approved IP instead of doing a second DNS lookup", async () => {
    await expect(executeFlowHttpAction(target)).resolves.toEqual({ status: 200, body: "ok" });
    const options = requestMock.mock.calls[0][1];
    const callback = vi.fn();
    options.lookup("hooks.example.net", { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [{ address: "93.184.216.34", family: 4 }]);
    expect(lookupMock).toHaveBeenCalledTimes(1);
    expect(options.headers["Idempotency-Key"]).toBe("effect:1");
  });
  it("does not follow redirects to a new destination", async () => {
    mockResponse(302);
    await expect(executeFlowHttpAction(target)).rejects.toMatchObject({ code: "REDIRECT" });
    expect(requestMock).toHaveBeenCalledTimes(1);
  });
  it("bounds streaming response bytes even without a content-length", async () => {
    mockResponse(200, "x".repeat(65 * 1024));
    await expect(executeFlowHttpAction(target)).rejects.toMatchObject({ code: "TOO_LARGE" });
  });
  it("bounds payloads and prevents header injection", async () => {
    await expect(executeFlowHttpAction({ ...target, payload: { text: "x".repeat(65 * 1024) } })).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    await expect(executeFlowHttpAction({ ...target, idempotencyKey: "id\r\nAuthorization: secret" })).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    expect(requestMock).not.toHaveBeenCalled();
  });
  it("includes DNS lookup in the ten second time budget", async () => {
    vi.useFakeTimers(); lookupMock.mockReturnValue(new Promise(() => {}));
    const result = executeFlowHttpAction(target);
    const checked = expect(result).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(10_000); await checked;
    expect(requestMock).not.toHaveBeenCalled();
  });
  it("blocks IPv6 transition/documentation addresses", () => {
    expect(isPublicFlowIp("2001:db8::1")).toBe(false);
    expect(isPublicFlowIp("2002:7f00:1::1")).toBe(false);
    expect(isPublicFlowIp("2606:4700:4700::1111")).toBe(true);
  });
});
