import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), advance: vi.fn() }));
vi.mock("@/lib/integrations/musa/auth", () => ({ requireMusaConnection: mocks.auth }));
vi.mock("@/lib/integrations/musa/publications", () => ({ advanceMusaPublication: mocks.advance, getMusaPublication: vi.fn() }));
import { PUT } from "@/app/api/integrations/musa/v1/publications/[publicationId]/route";

const uuid = "320c1b61-061c-4d0b-8dac-e0be8a51b5fb";
const context = { params: Promise.resolve({ publicationId: uuid }) };
const payload = { accountId: "account-a", caption: "Publicación de prueba", format: "carousel", mediaItems: [
  { type: "image", url: "https://cdn.example.com/a.jpg" }, { type: "video", url: "https://cdn.example.com/a.mp4" },
] };
const request = (body: string, headers = {}) => new Request("https://example.invalid/api/integrations/musa/v1/publications/" + uuid,
  { method: "PUT", body, headers: { "Content-Type": "application/json", ...headers } });
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ connectionId: "grant-a" });
  mocks.advance.mockResolvedValue({ version: 1, publicationId: uuid, status: "processing" }); });

describe("bounded modern publication request", () => {
  it("accepts ten complete URLs and Unicode caption above the old 20KB ceiling", async () => {
    const mediaItems = Array.from({ length: 10 }, (_, n) => ({ type: n % 2 ? "video" : "image",
      url: "https://cdn.example.com/" + "a".repeat(1970) }));
    const body = JSON.stringify({ ...payload, caption: "á".repeat(2200), mediaItems });
    expect(Buffer.byteLength(body, "utf8")).toBeGreaterThan(20_000);
    expect(Buffer.byteLength(body, "utf8")).toBeLessThan(40_000);
    const response = await PUT(request(body), context);
    expect(response.status).toBe(200); expect(mocks.advance).toHaveBeenCalledExactlyOnceWith(
      { connectionId: "grant-a" }, uuid, { ...payload, caption: "á".repeat(2200), mediaItems });
  });
  it("rejects an oversized declared body before reading it", async () => {
    const req = request("{}", { "Content-Length": "40001" }); const read = vi.spyOn(req, "text");
    expect((await PUT(req, context)).status).toBe(413); expect(read).not.toHaveBeenCalled(); expect(mocks.advance).not.toHaveBeenCalled();
  });
  it.each(["a".repeat(40_001), "😀".repeat(11_000)])("bounds actual UTF-8 bytes even without a size header", async body => {
    expect((await PUT(request(body), context)).status).toBe(413); expect(mocks.advance).not.toHaveBeenCalled();
  });
  it.each([
    { ...payload, format: "image" },
    { ...payload, mediaItems: [{ type: "image", url: "http://cdn.example.com/a.jpg" }, payload.mediaItems[1]] },
    { ...payload, videoUrl: "https://cdn.example.com/a.mp4" },
  ])("rejects incomplete, unsafe or ambiguous formats before dispatch", async body => {
    expect((await PUT(request(JSON.stringify(body)), context)).status).toBe(400); expect(mocks.advance).not.toHaveBeenCalled();
  });
});
