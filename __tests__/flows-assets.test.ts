import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  baseUrl: vi.fn(),
  asset: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), aggregate: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
  chunk: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn() },
  raw: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ getBaseUrl: mocks.baseUrl }));
vi.mock("@/lib/workspace-access", () => ({ getCurrentWorkspaceContext: mocks.context, canManageWorkspace: (role: string) => role === "OWNER" || role === "ADMIN" }));
vi.mock("@/lib/db/client", () => ({ prisma: { flowAsset: mocks.asset, flowAssetChunk: mocks.chunk, $transaction: mocks.transaction } }));
import { POST as create } from "@/app/api/flow-assets/route";
import { PUT as putChunk } from "@/app/api/flow-assets/[id]/chunks/[index]/route";
import { POST as complete } from "@/app/api/flow-assets/[id]/complete/route";
import { DELETE as remove } from "@/app/api/flow-assets/[id]/route";
import { GET as download, HEAD as head } from "@/app/api/flow-assets/public/[token]/route";
import { expectedFlowChunkBytes, FLOW_ASSET_CHUNK_BYTES, parseFlowAssetMetadata, readFlowAssetBody, validateFlowAssetContent } from "@/app/api/flow-assets/_shared";

const token = "a".repeat(43);
const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
const asset = { id: "asset", workspaceId: "workspace", name: "Guía.pdf", mimeType: "application/pdf", kind: "pdf", byteSize: pdf.length, chunkCount: 1, publicToken: token, status: "UPLOADING", createdAt: new Date() };
const idParams = { params: Promise.resolve({ id: "asset" }) };
const publicParams = { params: Promise.resolve({ token }) };
const post = (body: unknown) => new Request("https://openreply.example.net/api/flow-assets", { method: "POST", body: JSON.stringify(body) });
const binary = (body: Uint8Array) => new Request("https://openreply.example.net/chunks/0", { method: "PUT", body: new Uint8Array(body) });
const empty = () => new Request("https://openreply.example.net", { method: "POST" });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({ workspaceId: "workspace", userId: "owner", role: "OWNER" });
  mocks.baseUrl.mockReturnValue("https://openreply.example.net");
  mocks.asset.findFirst.mockResolvedValue({ ...asset });
  mocks.asset.findUnique.mockResolvedValue({ ...asset, status: "READY" });
  mocks.asset.aggregate.mockResolvedValue({ _sum: { byteSize: 0 } });
  mocks.asset.create.mockImplementation(async ({ data }) => ({ ...asset, ...data }));
  mocks.asset.update.mockImplementation(async ({ data }) => ({ ...asset, ...data }));
  mocks.asset.deleteMany.mockResolvedValue({ count: 1 });
  mocks.chunk.findMany.mockResolvedValue([{ index: 0, data: new Uint8Array(pdf) }]);
  mocks.chunk.findUnique.mockResolvedValue({ data: new Uint8Array(pdf) });
  mocks.transaction.mockImplementation(async (callback) => callback({ flowAsset: mocks.asset, flowAssetChunk: mocks.chunk, $queryRaw: mocks.raw }));
});

describe("flow asset validation", () => {
  it.each([
    { name: "code.svg", mimeType: "image/svg+xml", byteSize: 10 },
    { name: "page.html", mimeType: "text/html", byteSize: 10 },
    { name: "wrong.pdf", mimeType: "image/png", byteSize: 10 },
    { name: "../guide.pdf", mimeType: "application/pdf", byteSize: 10 },
    { name: "audio.mp3", mimeType: "audio/mpeg", byteSize: 10 },
    { name: "empty.pdf", mimeType: "application/pdf", byteSize: 0 },
    { name: "big.png", mimeType: "image/png", byteSize: 8 * 1024 * 1024 + 1 },
  ])("rejects forbidden or mismatched metadata $name", (metadata) => expect(() => parseFlowAssetMetadata(metadata)).toThrow());
  it("normalizes compatible audio MIME aliases and computes exact final chunks", () => {
    expect(parseFlowAssetMetadata({ name: "voice.m4a", mimeType: "audio/x-m4a", byteSize: FLOW_ASSET_CHUNK_BYTES + 5 })).toMatchObject({ mimeType: "audio/mp4", kind: "audio", chunkCount: 2 });
    expect(expectedFlowChunkBytes(FLOW_ASSET_CHUNK_BYTES + 5, 1)).toBe(5);
    expect(() => expectedFlowChunkBytes(FLOW_ASSET_CHUNK_BYTES + 5, 2)).toThrow();
  });
  it("rejects disguised HTML and incomplete containers", () => {
    expect(() => validateFlowAssetContent(Buffer.from("<html>danger</html>"), "application/pdf")).toThrow();
    expect(() => validateFlowAssetContent(Buffer.from("%PDF-1.7\ntruncated"), "application/pdf")).toThrow();
    expect(() => validateFlowAssetContent(pdf, "application/pdf")).not.toThrow();
  });
  it("bounds incoming bytes even with missing content-length", async () => {
    await expect(readFlowAssetBody(binary(new Uint8Array(11)), 10)).rejects.toMatchObject({ status: 413 });
  });
});

describe("flow asset authenticated upload", () => {
  it("requires authentication and administrator privileges before writing", async () => {
    mocks.context.mockResolvedValue(null);
    expect((await create(post({}))).status).toBe(401);
    mocks.context.mockResolvedValue({ workspaceId: "workspace", role: "MEMBER" });
    expect((await create(post({}))).status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("reserves quota under a workspace lock and returns the upload contract", async () => {
    const response = await create(post({ name: asset.name, mimeType: asset.mimeType, byteSize: asset.byteSize }));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ asset: { id: "asset", url: null, uploadUrl: "/api/flow-assets/asset/chunks/{index}" }, chunkSize: 1048576 });
    expect(mocks.raw).toHaveBeenCalled();
    expect(mocks.asset.create.mock.calls[0][0].data).toMatchObject({ workspaceId: "workspace", chunkCount: 1, kind: "pdf" });
    expect(mocks.asset.create.mock.calls[0][0].data.publicToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
  it("rejects creation without public HTTPS and exceeding workspace quota", async () => {
    mocks.baseUrl.mockReturnValue("http://localhost:3000");
    expect((await create(post({ name: asset.name, mimeType: asset.mimeType, byteSize: asset.byteSize }))).status).toBe(503);
    mocks.baseUrl.mockReturnValue("https://openreply.example.net");
    mocks.asset.aggregate.mockResolvedValue({ _sum: { byteSize: 512 * 1024 * 1024 } });
    expect((await create(post({ name: asset.name, mimeType: asset.mimeType, byteSize: asset.byteSize }))).status).toBe(413);
    expect(mocks.asset.create).not.toHaveBeenCalled();
  });
  it("scopes every chunk to the current workspace and checks exact size", async () => {
    mocks.asset.findFirst.mockResolvedValueOnce(null);
    expect((await putChunk(binary(pdf), { params: Promise.resolve({ id: "other-asset", index: "0" }) })).status).toBe(404);
    expect(mocks.asset.findFirst).toHaveBeenCalledWith({ where: { id: "other-asset", workspaceId: "workspace" } });
    expect((await putChunk(binary(pdf.subarray(0, 5)), { params: Promise.resolve({ id: "asset", index: "0" }) })).status).toBe(400);
    expect(mocks.chunk.upsert).not.toHaveBeenCalled();
    expect((await putChunk(binary(pdf), { params: Promise.resolve({ id: "asset", index: "0" }) })).status).toBe(200);
    expect(mocks.chunk.upsert.mock.calls[0][0].create.data).toEqual(new Uint8Array(pdf));
  });
  it("does not upload after completion raced with the chunk request", async () => {
    mocks.asset.findFirst.mockResolvedValueOnce(asset).mockResolvedValueOnce({ ...asset, status: "READY" });
    expect((await putChunk(binary(pdf), { params: Promise.resolve({ id: "asset", index: "0" }) })).status).toBe(409);
    expect(mocks.chunk.upsert).not.toHaveBeenCalled();
  });
  it("publishes only after all parts and the real file format are verified", async () => {
    mocks.chunk.findMany.mockResolvedValueOnce([]);
    expect((await complete(empty(), idParams)).status).toBe(400);
    mocks.chunk.findMany.mockResolvedValueOnce([{ index: 0, data: Buffer.alloc(pdf.length) }]);
    expect((await complete(empty(), idParams)).status).toBe(400);
    expect(mocks.asset.update).not.toHaveBeenCalled();
    const response = await complete(empty(), idParams);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { id: "asset", type: "pdf", url: `https://openreply.example.net/api/flow-assets/public/${token}` } });
    expect(mocks.asset.update).toHaveBeenCalledWith({ where: { id: "asset" }, data: { status: "READY" } });
  });
  it("uses workspace scope for deletion", async () => {
    expect((await remove(empty(), idParams)).status).toBe(200);
    expect(mocks.asset.deleteMany).toHaveBeenCalledWith({ where: { id: "asset", workspaceId: "workspace" } });
  });
});

describe("flow asset opaque public download", () => {
  it("streams verified PDF bytes with safe type and download headers", async () => {
    const response = await download(new Request("https://openreply.example.net"), publicParams);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-disposition")).toContain("attachment;");
    expect(response.headers.get("location")).toBeNull();
    expect(Buffer.from(await response.arrayBuffer())).toEqual(pdf);
    expect(mocks.context).not.toHaveBeenCalled();
  });
  it("hides unready files and malformed tokens", async () => {
    expect((await download(new Request("https://openreply.example.net"), { params: Promise.resolve({ token: "asset-id" }) })).status).toBe(404);
    mocks.asset.findUnique.mockResolvedValueOnce(asset);
    expect((await download(new Request("https://openreply.example.net"), publicParams)).status).toBe(404);
    expect(mocks.chunk.findUnique).not.toHaveBeenCalled();
  });
  it("serves bounded byte ranges and HEAD without fetching chunk bytes", async () => {
    const response = await download(new Request("https://openreply.example.net", { headers: { range: "bytes=5-9" } }), publicParams);
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(`bytes 5-9/${pdf.length}`);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(pdf.subarray(5, 10));
    mocks.chunk.findUnique.mockClear();
    const headerResponse = await head(new Request("https://openreply.example.net", { method: "HEAD" }), publicParams);
    expect(headerResponse.headers.get("content-length")).toBe(String(pdf.length));
    expect(await headerResponse.text()).toBe("");
    expect(mocks.chunk.findUnique).not.toHaveBeenCalled();
    expect((await download(new Request("https://openreply.example.net", { headers: { range: "bytes=999-1000" } }), publicParams)).status).toBe(416);
  });
});
