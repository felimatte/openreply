import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";

const state = vi.hoisted(() => ({ db: undefined as unknown as import("@/app/generated/prisma/client").PrismaClient }));
vi.mock("@/lib/db/client", () => ({ get prisma() { return state.db; } }));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/workspace-selection", () => ({ SELECTED_WORKSPACE_COOKIE: "openreply-workspace" }));
import { createIndependentWorkspace, WORKSPACE_CREATION_LIMIT } from "@/lib/workspace-management";

const databaseUrl = process.env.MUSA_TEST_DATABASE_URL;
const ownerId = `qa-workspaces-${randomUUID()}`;
const email = `${ownerId}@example.test`;
describe.skipIf(!databaseUrl)("workspace creation against disposable PostgreSQL", () => {
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (url.hostname !== "127.0.0.1" || url.port !== "57322" || url.pathname !== "/openreply_musa_qa") throw new Error("Requires the dedicated disposable local QA database.");
    state.db = new PrismaClient({ adapter: new PrismaPg(databaseUrl!) });
    vi.stubEnv("ALLOWED_EMAILS", email);
    await state.db.user.create({ data: { id: ownerId, email } });
  });
  afterAll(async () => {
    if (!state.db) return;
    await state.db.user.deleteMany({ where: { id: ownerId } });
    await state.db.$disconnect();
    vi.unstubAllEnvs();
  });

  it("creates independent workspaces with exactly one OWNER and no moved accounts", async () => {
    const workspace = await createIndependentWorkspace(ownerId, { name: "QA client one" });
    expect(await state.db.workspaceMember.findMany({ where: { workspaceId: workspace.id }, select: { userId: true, role: true } })).toEqual([{ userId: ownerId, role: "OWNER" }]);
    expect(await state.db.instagramAccount.count({ where: { workspaceId: workspace.id } })).toBe(0);
    await state.db.workspace.delete({ where: { id: workspace.id } });
  });

  it("allows only one of two concurrent creations when the hourly quota has one slot", async () => {
    await state.db.workspace.createMany({ data: Array.from({ length: WORKSPACE_CREATION_LIMIT - 1 }, (_, i) => ({ name: `QA seeded ${i}`, ownerId })) });
    const results = await Promise.allSettled([
      createIndependentWorkspace(ownerId, { name: "QA concurrent A" }),
      createIndependentWorkspace(ownerId, { name: "QA concurrent B" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 429, code: "CREATION_RATE_LIMITED" });
    expect(await state.db.workspace.count({ where: { ownerId } })).toBe(WORKSPACE_CREATION_LIMIT);
    expect(await state.db.workspaceMember.count({ where: { userId: ownerId } })).toBe(1);
  });
});
