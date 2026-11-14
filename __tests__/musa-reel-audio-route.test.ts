import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), context: vi.fn() }));
vi.mock("@/lib/integrations/musa/auth", async (original) => ({
  ...await original<typeof import("@/lib/integrations/musa/auth")>(), requireMusaConnection: mocks.auth,
}));
vi.mock("@/lib/instagram/context", () => ({ createInstagramContext: mocks.context }));

import { GET } from "@/app/api/integrations/musa/v1/audio/route";
import { MusaIntegrationError } from "@/lib/integrations/musa/errors";

const fetchMock = vi.fn();
const provider = { provider: "ZERNIO", accountId: "remote-a", apiKey: "server-test-key", instagramId: "ig-a" };
const account = { id: "account-a", provider: "ZERNIO", zernioAccountId: provider.accountId };
const track = { audioId: "123456", audioType: "music", title: "Sample track", displayArtist: "Sample artist",
  downloadUrl: "https://scontent.cdninstagram.com/o1/audio.mp4?temporary=1", untrusted: "do not echo" };

function request(query = "accountId=account-a") {
  return new Request(`https://example.invalid/audio?${query}`);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  mocks.auth.mockResolvedValue({ accounts: [account] });
  mocks.context.mockResolvedValue(provider);
});
afterEach(() => vi.unstubAllGlobals());

describe("MUSA Reel audio boundary", () => {
  it("searches the granted remote account, encodes the query and returns only catalog fields", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ audio: [track] }));
    const response = await GET(request("accountId=account-a&q=artist%26format%3Dimage"));
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ version: 1, accountId: "account-a", available: true,
      tracks: [{ id: track.audioId, title: track.title, artist: track.displayArtist, previewUrl: track.downloadUrl }] });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "https://zernio.com/api/v1/accounts/remote-a/instagram/audio?audioType=music&q=artist%26format%3Dimage",
      expect.objectContaining({ method: "GET", redirect: "error", headers: expect.objectContaining({
        Authorization: "Bearer server-test-key",
      }) }),
    );
  });
  it("refreshes the exact track and omits preview URLs outside the Instagram CDN", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ audio: { ...track, downloadUrl: "https://cdninstagram.com.example.com/file" } }));
    const response = await GET(request("accountId=account-a&audioId=123456"));
    expect(await response.json()).toMatchObject({ available: true, tracks: [{ id: "123456", previewUrl: null }] });
    expect(fetchMock.mock.calls[0][0]).toBe("https://zernio.com/api/v1/accounts/remote-a/instagram/audio/123456");
  });
  it("does not substitute a different track returned by the provider", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ audio: { ...track, audioId: "another" } }));
    expect((await GET(request("accountId=account-a&audioId=123456"))).status).toBe(503);
  });
  it("distinguishes an empty result from a provider without catalog audio", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ audio: [] }));
    expect(await (await GET(request())).json()).toEqual({ version: 1, accountId: "account-a", available: true, tracks: [] });
    fetchMock.mockResolvedValueOnce(Response.json({ code: "instagram_audio_requires_facebook_login" }, { status: 400 }));
    expect(await (await GET(request())).json()).toEqual({ version: 1, accountId: "account-a", available: false, tracks: [] });
  });
  it("reports the direct Instagram Login connection as unavailable without calling Zernio", async () => {
    mocks.auth.mockResolvedValue({ accounts: [{ ...account, provider: "META", zernioAccountId: null }] });
    expect(await (await GET(request())).json()).toEqual({ version: 1, accountId: "account-a", available: false, tracks: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([[404, 404, "REEL_AUDIO_UNAVAILABLE"], [403, 403, "RECONNECT_REQUIRED"],
    [429, 429, "PROVIDER_RATE_LIMIT"], [502, 503, "REEL_AUDIO_TEMPORARILY_UNAVAILABLE"]])(
    "maps provider status %s without disclosing raw details", async (status, expected, code) => {
      fetchMock.mockResolvedValueOnce(Response.json({ error: "private provider content" }, { status }));
      const response = await GET(request("accountId=account-a&audioId=123456"));
      expect(response.status).toBe(expected);
      const payload = await response.json();
      expect(payload.error.code).toBe(code);
      expect(JSON.stringify(payload)).not.toContain("private provider content");
    },
  );
  it("denies revoked grants and cross-account access before looking up any track", async () => {
    expect((await GET(request("accountId=another-account"))).status).toBe(403);
    mocks.auth.mockRejectedValueOnce(new MusaIntegrationError(401, "UNAUTHORIZED", "Revoked"));
    expect((await GET(request())).status).toBe(401);
    expect(mocks.context).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["q=track&audioId=123", "audioId=../../other", "audioId=1&audioId=2"])("rejects an ambiguous or invalid lookup: %s", async (query) => {
    expect((await GET(request(`accountId=account-a&${query}`))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
