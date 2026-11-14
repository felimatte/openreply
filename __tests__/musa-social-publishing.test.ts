import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getAccounts } from "@/app/api/integrations/musa/v1/social/accounts/route";
import { GET as getCreator } from "@/app/api/integrations/musa/v1/social/accounts/[accountId]/creator-info/route";
import { GET, PUT } from "@/app/api/integrations/musa/v1/social/publications/[publicationId]/route";
import type { MusaSocialPublication, Prisma } from "@/app/generated/prisma/client";

const db = vi.hoisted(() => ({ findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ prisma: { musaSocialPublication: db } }));

const businessId = "4000d236-6a14-4144-8cad-f8f4b674f9e7";
const publicationId = "a3cb8ef2-82fb-48bd-8062-1912dd93c003";
const connectionId = "pilot-a";
const profileId = "3425517c5b895ea764163a71";
const facebookId = "760c7183dd04a87f825b8725";
const tiktokId = "ec8908b37682284b6d841b87";
const pageId = "775431365121589";
const tiktokUser = "tiktok-native-id";
const remoteId = "4d504d2b33b3f8f3d66e7161";
const otherId = "a09e498f6db34eb15284e68d";
const bearer = "test-only-bridge-token-musa-social-0001";
const vendorKey = "fixture-only-zernio-api-key";
const route = { params: Promise.resolve({ publicationId }) };
const outgoing = vi.fn<typeof fetch>();
const facebookPayload = {
  connectionId, platform: "facebook", accountId: facebookId, caption: "",
  videoUrl: "https://media.example.test/clip.mp4?signature=fixture",
  scheduledFor: new Date(Date.now() - 60_000).toISOString(),
};
const tikTokPayload = { ...facebookPayload, platform: "tiktok", accountId: tiktokId, tiktok: {
  privacyLevel: "PUBLIC_TO_EVERYONE", allowComment: false, allowDuet: false, allowStitch: false,
  contentPreviewConfirmed: true, expressConsentGiven: true, commercialContentType: "none",
} };
const creator = {
  creator: { canPostMore: true }, privacyLevels: [{ value: "PUBLIC_TO_EVERYONE" }],
  postingLimits: { maxVideoDurationSec: 120, interactionSettings: {
    allow_comment: { enabled: true }, allow_duet: { enabled: false }, allow_stitch: { enabled: false },
  } },
  commercialContentTypes: [{ value: "none" }, { value: "brand_organic" }],
};

type Row = MusaSocialPublication;
type FindArgs = { where: Prisma.MusaSocialPublicationWhereInput };
type UpdateArgs = FindArgs & { data: Partial<Row> };
let row: Row | undefined;
let mockRemotePost: ReturnType<typeof providerPost>;
let expectTikTokUser: string;
let addFacebookPage: boolean;

function providerPost(platform = "facebook", accountId = facebookId, status = "pending", platformPostId: string | null = null,
  platformPostUrl: string | null = null) {
  return { post: { _id: remoteId, platforms: [{ platform, accountId: { _id: accountId },
    status, platformPostId, platformPostUrl }] } };
}

function request(method = "GET", body?: unknown, targetBusiness = businessId, token = bearer) {
  return new Request("https://bridge.example.test/api/social", { method,
    headers: { Authorization: "Bearer " + token, "X-Musa-Business-Id": targetBusiness },
    body: body === undefined ? undefined : JSON.stringify(body) });
}

function matches(where: Prisma.MusaSocialPublicationWhereInput) {
  if (!row) return false;
  const tick = Date.now();
  return row.publicationId === where.publicationId && row.businessId === where.businessId && row.connectionId === where.connectionId &&
    (where.profileId === undefined || row.profileId === where.profileId) &&
    (where.status === undefined || row.status === where.status) &&
    (where.leaseToken === undefined || row.leaseToken === where.leaseToken) &&
    (where.providerPostId === undefined || row.providerPostId === where.providerPostId) &&
    (where.updatedAt === undefined || row.updatedAt === where.updatedAt) &&
    (!where.AND || (row.leaseUntil?.getTime() ?? 0) <= tick && (row.nextAttemptAt?.getTime() ?? 0) <= tick);
}

async function provider(input: string | URL | Request) {
  const path = new URL(String(input)).pathname;
  if (path === "/api/v1/accounts") return Response.json({ accounts: [
    { _id: otherId, platform: "tiktok", profileId, username: "unrelated", isActive: true },
    { _id: facebookId, platform: "facebook", profileId: { _id: profileId }, username: "fb-user", isActive: true },
    { _id: tiktokId, platform: "tiktok", profileId, platformUserId: expectTikTokUser, username: "cocinando", isActive: true },
  ] });
  if (path.endsWith("/health")) {
    const accountId = path.split("/")[4];
    return Response.json({ accountId, platform: accountId === facebookId ? "facebook" : "tiktok",
      status: "healthy", tokenStatus: { valid: true }, permissions: { canPost: true } });
  }
  if (path.endsWith("/facebook-page")) return Response.json({ selectedPageId: "15", pages: [
    { id: "15", name: "Unrelated default Page" }, ...(addFacebookPage ? [{ id: pageId, name: "Cocinando IA" }] : []),
  ] });
  if (path.endsWith("/creator-info")) return Response.json(creator);
  if (path === "/api/v1/posts" || path === "/api/v1/posts/" + remoteId) return Response.json(mockRemotePost);
  throw new Error("Unexpected fixture endpoint: " + path);
}

function upstreamPosts() {
  return outgoing.mock.calls.filter(([target, options]) => String(target).endsWith("/posts") && options?.method === "POST");
}

function releaseDelay() {
  if (!row) throw new Error("Expected receipt");
  row.nextAttemptAt = null;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  row = undefined;
  addFacebookPage = true;
  expectTikTokUser = tiktokUser;
  mockRemotePost = providerPost();
  const env = {
    MUSA_SOCIAL_BUSINESS_ID: businessId, MUSA_SOCIAL_CONNECTION_ID: connectionId,
    MUSA_SOCIAL_BRIDGE_TOKEN: bearer, MUSA_SOCIAL_PROFILE_ID: profileId, ZERNIO_API_KEY: vendorKey,
    MUSA_SOCIAL_FACEBOOK_ACCOUNT_ID: facebookId, MUSA_SOCIAL_FACEBOOK_PAGE_ID: pageId,
    MUSA_SOCIAL_TIKTOK_ACCOUNT_ID: tiktokId, MUSA_SOCIAL_TIKTOK_PLATFORM_USER_ID: tiktokUser,
  };
  Object.entries(env).forEach(([name, value]) => vi.stubEnv(name, value));
  vi.stubGlobal("fetch", outgoing);
  outgoing.mockReset().mockImplementation(provider);
  db.findFirst.mockImplementation(async ({ where }: FindArgs) => matches(where) ? { ...row } : null);
  db.create.mockImplementation(async ({ data }: { data: Partial<Row> }) => {
    if (row) throw { code: "P2002" };
    row = { status: "processing", providerPostId: null, providerScheduledAt: null, attemptStartedAt: null,
      nextAttemptAt: null, leaseToken: null, leaseUntil: null, mediaId: null, permalink: null, errorCode: null,
      createdAt: new Date(), updatedAt: new Date(), ...data } as Row;
    return { ...row };
  });
  db.updateMany.mockImplementation(async ({ where, data }: UpdateArgs) => {
    if (!matches(where)) return { count: 0 };
    row = { ...row, ...data, updatedAt: new Date() } as Row;
    return { count: 1 };
  });
});

describe("MUSA Facebook and TikTok bridge", () => {
  it("protects the pilot and lists only pinned accounts and their publication capability", async () => {
    expect((await getAccounts(request("GET", undefined, "unknown"))).status).toBe(401);
    expect((await getAccounts(request("GET", undefined, businessId, "wrong-token"))).status).toBe(401);
    expect(outgoing).not.toHaveBeenCalled();

    const response = await getAccounts(request());
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ version: 1, connectionId, accounts: [
      { id: facebookId, platform: "facebook", username: "Cocinando IA", pageId, canPublish: true },
      { id: tiktokId, platform: "tiktok", username: "cocinando", canPublish: true },
    ] });
    expect(outgoing.mock.calls.every(([, options]) => options?.method === "GET")).toBe(true);
  });

  it("reads creator options without defaults, and refuses a substituted TikTok account", async () => {
    const context = { params: Promise.resolve({ accountId: tiktokId }) };
    const response = await getCreator(request(), context);
    expect(await response.json()).toEqual({ version: 1, accountId: tiktokId,
      privacyLevels: ["PUBLIC_TO_EVERYONE"], commercialContentTypes: ["none", "brand_organic"],
      interactionSettings: { allowComment: true, allowDuet: false, allowStitch: false },
      canPostMore: true, maxVideoDurationSec: 120 });

    expectTikTokUser = "substituted-tiktok";
    expect((await getCreator(request(), context)).status).toBe(403);
    expect(upstreamPosts()).toHaveLength(0);
  });

  it("lists a healthy TikTok when Facebook cannot confirm its Page", async () => {
    outgoing.mockImplementation(async (input) => String(input).endsWith("/facebook-page")
      ? Response.json({}, { status: 502 }) : provider(input));
    const response = await getAccounts(request());
    expect(await response.json()).toEqual({ version: 1, connectionId, accounts: [
      { id: tiktokId, platform: "tiktok", username: "cocinando", canPublish: true },
    ] });
    expect(upstreamPosts()).toHaveLength(0);
  });

  it("creates one Reel for the pinned Page, leaves the caption empty, and reads the exact receipt", async () => {
    expect((await GET(request(), route)).status).toBe(404);
    const response = await PUT(request("PUT", facebookPayload), route);
    expect(await response.json()).toMatchObject({ version: 1, publicationId, status: "processing", mediaId: null });
    const [[, write]] = upstreamPosts();
    expect(write?.headers).toMatchObject({ "Idempotency-Key": publicationId });
    const sent = JSON.parse(String(write?.body));
    expect(sent).not.toHaveProperty("content");
    expect(sent.platforms).toEqual([{ platform: "facebook", accountId: facebookId,
      platformSpecificData: { contentType: "reel", pageId } }]);
    expect(Date.parse(sent.scheduledFor)).toBeGreaterThan(Date.now());

    releaseDelay();
    mockRemotePost = providerPost("facebook", facebookId, "published", "facebook-post-id", "https://www.facebook.com/reel/123");
    const published = await GET(request(), route);
    expect(await published.json()).toEqual({ version: 1, publicationId, status: "published", mediaId: "facebook-post-id",
      permalink: "https://www.facebook.com/reel/123", errorCode: null, retryAfterSeconds: null });
    expect(upstreamPosts()).toHaveLength(1);
  });

  it("enforces TikTok consent and keeps waiting when the provider has yet to return a media ID", async () => {
    expect((await PUT(request("PUT", { ...tikTokPayload, tiktok: { ...tikTokPayload.tiktok, expressConsentGiven: false } }), route)).status).toBe(400);
    mockRemotePost = providerPost("tiktok", tiktokId, "published");
    expect(await (await PUT(request("PUT", tikTokPayload), route)).json()).toMatchObject({ status: "processing", mediaId: null });
    const [[, write]] = upstreamPosts();
    expect(JSON.parse(String(write?.body)).tiktokSettings).toEqual({
      privacy_level: "PUBLIC_TO_EVERYONE", allow_comment: false, allow_duet: false, allow_stitch: false,
      content_preview_confirmed: true, express_consent_given: true, commercialContentType: "none",
    });
    releaseDelay();
    mockRemotePost = providerPost("tiktok", tiktokId, "published", "7462617259000");
    expect(await (await GET(request(), route)).json()).toMatchObject({ status: "published", mediaId: "7462617259000" });
    expect(upstreamPosts()).toHaveLength(1);

    releaseDelay();
    mockRemotePost = providerPost("tiktok", tiktokId, "published", "unrelated-native-id", "https://www.tiktok.com/@other/video/123");
    expect(await (await GET(request(), route)).json()).toMatchObject({ status: "published", mediaId: "7462617259000", permalink: null });
    releaseDelay();
    mockRemotePost = providerPost("tiktok", tiktokId, "published", "7462617259000", "https://www.tiktok.com/@cocinando/video/7462617259000");
    expect(await (await GET(request(), route)).json()).toMatchObject({ status: "published", mediaId: "7462617259000",
      permalink: "https://www.tiktok.com/@cocinando/video/7462617259000" });
  });

  it("replays an ambiguous timeout with the identical provider URL, timestamp, body and UUID", async () => {
    let sendCount = 0;
    outgoing.mockImplementation(async (input, init) => {
      if (init?.method === "POST" && sendCount++ === 0) throw new Error("timeout");
      return provider(input);
    });
    expect(await (await PUT(request("PUT", facebookPayload), route)).json()).toMatchObject({
      status: "processing", errorCode: "PROVIDER_UNREACHABLE",
    });
    releaseDelay();
    expect((await PUT(request("PUT", { ...facebookPayload, caption: "changed" }), route)).status).toBe(409);
    expect(await (await GET(request(), route)).json()).toMatchObject({ status: "processing" });
    expect(upstreamPosts()).toHaveLength(1);
    expect((await PUT(request("PUT", facebookPayload), route)).status).toBe(200);
    const [first, second] = upstreamPosts();
    expect(first[0]).toBe(second[0]);
    expect(first[1]?.body).toBe(second[1]?.body);
    expect(first[1]?.headers).toEqual(second[1]?.headers);
  });

  it("fails closed if the Page was removed, the account changed, the time is early, or the grant rotated", async () => {
    const future = new Date(Date.now() + 120_000).toISOString();
    expect((await PUT(request("PUT", { ...facebookPayload, scheduledFor: future }), route)).status).toBe(409);
    expect((await PUT(request("PUT", { ...facebookPayload, accountId: otherId }), route)).status).toBe(403);
    expect(outgoing).not.toHaveBeenCalled();
    addFacebookPage = false;
    expect(await (await PUT(request("PUT", facebookPayload), route)).json()).toMatchObject({
      status: "failed", errorCode: "RECONNECT_REQUIRED",
    });
    expect(upstreamPosts()).toHaveLength(0);

    vi.stubEnv("MUSA_SOCIAL_FACEBOOK_PAGE_ID", "15");
    expect((await GET(request(), route)).status).toBe(409);
    vi.stubEnv("MUSA_SOCIAL_PROFILE_ID", otherId);
    expect((await GET(request(), route)).status).toBe(404);
    vi.stubEnv("MUSA_SOCIAL_PROFILE_ID", profileId);
    vi.stubEnv("MUSA_SOCIAL_CONNECTION_ID", "rotated");
    expect((await GET(request(), route)).status).toBe(404);
  });

  it("accepts concurrent confirmation of one UUID without creating two posts", async () => {
    const responses = await Promise.all([
      PUT(request("PUT", facebookPayload), route), PUT(request("PUT", facebookPayload), route),
    ]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(upstreamPosts()).toHaveLength(1);
  });
});
