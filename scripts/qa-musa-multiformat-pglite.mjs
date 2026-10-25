/** Disposable PostgreSQL WASM checks: no sockets, external services, env files or real accounts. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(new URL("../package.json", import.meta.url));
const { PGlite } = require("@electric-sql/pglite");
const db = new PGlite("memory://");
const migrationRoot = join(root, "prisma", "migrations");
const newest = "20261025120000_musa_multiformat";
const checks = [], applied = [];
const legacyPayload = { accountId: "qa-account", caption: "QA legacy", videoUrl: "https://cdn.example.com/qa.mp4" };
const legacyHash = createHash("sha256").update(JSON.stringify({ ...legacyPayload, coverUrl: null, campaignId: null })).digest("hex");
const legacyUuid = "320c1b61-061c-4d0b-8dac-e0be8a51b5fb";
const modernUuid = "820c1b61-061c-4d0b-8dac-e0be8a51b5fb";

async function check(name, operation) { await operation(); checks.push(name); }
async function rejects(name, sql, params, code, constraint) {
  await check(name, () => assert.rejects(db.query(sql, params), error => error.code === code && (!constraint || error.constraint === constraint)));
}
async function receipt(id = "qa-legacy") {
  return (await db.query('SELECT * FROM "MusaPublication" WHERE "id"=$1', [id])).rows[0];
}
async function applyMigration(name) {
  await db.exec(await readFile(join(migrationRoot, name, "migration.sql"), "utf8")); applied.push(name);
}
async function insertReceipt(id, uuid, payload, hash, provider = "META") {
  await db.query(`INSERT INTO "MusaPublication" ("id","connectionId","workspaceId","publicationId","accountId","provider","payloadHash","payload","updatedAt")
    VALUES ($1,'qa-grant','qa-workspace',$2::uuid,'qa-account',$3::"InstagramProvider",$4,$5::jsonb,now())`,
  [id, uuid, provider, hash, JSON.stringify(payload)]);
}

try {
  const version = (await db.query("SELECT version() AS version")).rows[0].version;
  const migrations = (await readdir(migrationRoot, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  assert.equal(migrations.at(-1), newest, "Update the QA insertion point when another migration follows multiformat");
  for (const name of migrations.filter(name => name !== newest)) await applyMigration(name);
  await insertReceipt("qa-legacy", legacyUuid, legacyPayload, legacyHash);
  await db.query(`UPDATE "MusaPublication" SET "status"='published',"stage"='DONE',"mediaId"='legacy-media' WHERE "id"='qa-legacy'`);
  const legacyBefore = await receipt();
  await applyMigration(newest);

  await check("all versioned migrations apply without modifying source SQL", () => assert.deepEqual(applied, migrations));
  await check("legacy payload, hash, media receipt and status survive the additive migration", async () => {
    const after = await receipt(); assert.deepEqual(after, { ...legacyBefore, childContainerIds: [] });
  });
  await check("new column is non-null text[] with empty default", async () => {
    const column = (await db.query(`SELECT data_type,udt_name,is_nullable,column_default FROM information_schema.columns
      WHERE table_name='MusaPublication' AND column_name='childContainerIds'`)).rows[0];
    assert.equal(column.data_type, "ARRAY"); assert.equal(column.udt_name, "_text"); assert.equal(column.is_nullable, "NO");
    assert.match(column.column_default, /ARRAY\[\]::text\[\]/i);
  });

  const payload = { accountId: "qa-account", caption: "Mixed", format: "carousel", mediaItems: [
    { type: "image", url: "https://cdn.example.com/qa.jpg" }, { type: "video", url: "https://cdn.example.com/qa.mp4" },
  ] };
  await insertReceipt("qa-modern", modernUuid, payload, "unchanged-modern-hash");
  await check("new rows inherit empty child progress", async () => assert.deepEqual((await receipt("qa-modern")).childContainerIds, []));
  await check("ordered child progress round-trips without changing payload/hash", async () => {
    await db.query('UPDATE "MusaPublication" SET "childContainerIds"=$1::text[],"stage"=\'META_CHILD_PROCESSING\' WHERE "id"=\'qa-modern\'', [["photo-first", "video-second"]]);
    const saved = await receipt("qa-modern"); assert.deepEqual(saved.childContainerIds, ["photo-first", "video-second"]);
    assert.deepEqual(saved.payload, payload); assert.equal(saved.payloadHash, "unchanged-modern-hash");
  });
  await check("exactly ten children are accepted", async () => {
    await db.query('UPDATE "MusaPublication" SET "childContainerIds"=$1::text[] WHERE "id"=\'qa-modern\'', [Array.from({ length: 10 }, (_, n) => `child-${n}`)]);
    assert.equal((await receipt("qa-modern")).childContainerIds.length, 10);
  });
  await rejects("eleven children violate the child constraint", 'UPDATE "MusaPublication" SET "childContainerIds"=$1::text[] WHERE "id"=\'qa-modern\'',
    [Array.from({ length: 11 }, (_, n) => `child-${n}`)], "23514", "MusaPublication_children_check");
  await rejects("NULL child array is rejected", 'UPDATE "MusaPublication" SET "childContainerIds"=NULL WHERE "id"=\'qa-modern\'', [], "23502");
  await rejects("NULL child element is rejected", 'UPDATE "MusaPublication" SET "childContainerIds"=ARRAY[NULL]::text[] WHERE "id"=\'qa-modern\'', [], "23514", "MusaPublication_children_check");
  await check("multidimensional arrays are rejected", async () => {
    await assert.rejects(db.query('UPDATE "MusaPublication" SET "childContainerIds"=ARRAY[[\'a\',\'b\'],[\'c\',\'d\']] WHERE "id"=\'qa-modern\''));
  });
  await db.query('UPDATE "MusaPublication" SET "childContainerIds"=$1::text[] WHERE "id"=\'qa-modern\'', [["photo-first", "video-second"]]);
  await rejects("a saved child cannot become the parent", 'UPDATE "MusaPublication" SET "containerId"=\'photo-first\' WHERE "id"=\'qa-modern\'', [], "23514", "MusaPublication_parent_check");
  await rejects("a parent cannot later be inserted among the children", `UPDATE "MusaPublication" SET "containerId"='parent',"childContainerIds"=ARRAY['parent'] WHERE "id"='qa-modern'`, [], "23514", "MusaPublication_parent_check");
  await check("a distinct parent is accepted", async () => {
    await db.query(`UPDATE "MusaPublication" SET "containerId"='parent',"stage"='META_PUBLISHING',"status"='uncertain' WHERE "id"='qa-modern'`);
    assert.equal((await receipt("qa-modern")).containerId, "parent");
  });
  await rejects("published without a media ID or exact proof remains forbidden", `UPDATE "MusaPublication" SET "status"='published' WHERE "id"='qa-modern'`, [], "23514");
  await rejects("a child proof cannot confirm a different parent", `UPDATE "MusaPublication" SET "status"='published',"confirmationContainerId"='photo-first' WHERE "id"='qa-modern'`, [], "23514");
  await rejects("Zernio cannot forge a Meta container proof", `UPDATE "MusaPublication" SET "provider"='ZERNIO',"status"='published',"confirmationContainerId"='parent' WHERE "id"='qa-modern'`, [], "23514");
  await check("exact parent proof without media ID preserves PR3 confirmation", async () => {
    await db.query(`UPDATE "MusaPublication" SET "status"='published',"stage"='DONE',"confirmationContainerId"='parent' WHERE "id"='qa-modern'`);
    const saved = await receipt("qa-modern"); assert.equal(saved.confirmationContainerId, saved.containerId); assert.equal(saved.mediaId, null);
  });
  await rejects("duplicate publication UUID remains globally unique across grants", `INSERT INTO "MusaPublication"
    ("id","connectionId","workspaceId","publicationId","accountId","provider","payloadHash","payload","updatedAt")
    VALUES ('qa-duplicate','other-grant','qa-workspace',$1::uuid,'qa-account','META','hash','{}',now())`, [modernUuid], "23505", "MusaPublication_publicationId_key");

  await db.exec(`INSERT INTO "User" ("id","email","updatedAt") VALUES ('qa-user','qa@example.invalid',now());
    INSERT INTO "Workspace" ("id","name","ownerId","updatedAt") VALUES ('qa-workspace','Synthetic','qa-user',now());
    INSERT INTO "InstagramAccount" ("id","workspaceId","instagramId","username","accessToken","updatedAt")
      VALUES ('qa-account','qa-workspace','qa-ig','qa_never_connected','not-a-token',now());
    INSERT INTO "Automation" ("id","workspaceId","instagramAccountId","name","dmMessage","keywords","isActive","pendingNextReel","updatedAt")
      VALUES ('qa-campaign','qa-workspace','qa-account','Synthetic','Never sent',ARRAY['qa'],false,true,now());
    UPDATE "MusaPublication" SET "campaignId"='qa-campaign' WHERE "id"='qa-modern';`);
  await rejects("confirmed parent without media ID keeps campaign activation blocked", `UPDATE "Automation" SET "isActive"=true WHERE "id"='qa-campaign'`, [], "23514");
  await rejects("confirmed parent without media ID keeps campaign retargeting blocked", `UPDATE "Automation" SET "postId"='wrong-media' WHERE "id"='qa-campaign'`, [], "23514");
  await rejects("confirmed parent without media ID keeps campaign deletion blocked", `DELETE FROM "Automation" WHERE "id"='qa-campaign'`, [], "23514");
  await check("an exact media ID releases only the reservation and keeps the campaign paused", async () => {
    await db.exec(`UPDATE "MusaPublication" SET "mediaId"='confirmed-media',"confirmationContainerId"=NULL WHERE "id"='qa-modern';
      UPDATE "Automation" SET "postId"='confirmed-media',"pendingNextReel"=false WHERE "id"='qa-campaign';`);
    const campaign = (await db.query('SELECT "postId","isActive" FROM "Automation" WHERE "id"=\'qa-campaign\'')).rows[0];
    assert.deepEqual(campaign, { postId: "confirmed-media", isActive: false });
  });

  await db.query(`UPDATE "MusaPublication" SET "status"='processing',"stage"='META_CHILD_PROCESSING',"leaseToken"=NULL,"leaseUntil"=NULL WHERE "id"='qa-legacy'`);
  const claim = token => db.query(`UPDATE "MusaPublication" SET "leaseToken"=$1,"leaseUntil"=now()+interval '30 seconds'
    WHERE "id"='qa-legacy' AND "status"='processing' AND ("leaseUntil" IS NULL OR "leaseUntil"<=now()) RETURNING "id"`, [token]);
  await check("lease CAS grants the first claimant and refuses the second", async () => {
    assert.equal((await claim("lease-a")).rows.length, 1); assert.equal((await claim("lease-b")).rows.length, 0);
  });
  await check("a different lease cannot append child progress", async () => {
    const result = await db.query(`UPDATE "MusaPublication" SET "childContainerIds"=ARRAY['wrong'] WHERE "id"='qa-legacy' AND "leaseToken"='lease-b' RETURNING "id"`);
    assert.equal(result.rows.length, 0); assert.deepEqual((await receipt()).childContainerIds, []);
  });
  await check("the owning lease persists exact ordered progress", async () => {
    const result = await db.query(`UPDATE "MusaPublication" SET "childContainerIds"=ARRAY['photo','video'] WHERE "id"='qa-legacy' AND "leaseToken"='lease-a' RETURNING "id"`);
    assert.equal(result.rows.length, 1); assert.deepEqual((await receipt()).childContainerIds, ["photo", "video"]);
  });
  await check("failed statements leave previously valid progress intact", async () => {
    assert.deepEqual((await receipt("qa-modern")).childContainerIds, ["photo-first", "video-second"]);
    assert.equal((await receipt("qa-modern")).payloadHash, "unchanged-modern-hash");
  });

  const report = { checkedAt: new Date().toISOString(), engine: version, memoryOnly: true, sockets: false,
    migrations: applied, passed: checks.length, checks,
    limitations: ["Direct SQL in PostgreSQL WASM; not Prisma transport or a server deployment.",
      "PGlite serializes one connection: CAS predicates are exercised, not independent concurrent PostgreSQL sessions.",
      "Provider/network behavior remains covered by mocked state-machine tests; no real publication occurs."] };
  const destination = resolve(root, process.argv[2] ?? "progress/evidencia-multiformato-pglite.json");
  assert.ok(destination.startsWith(root + sep), "Report must remain inside this exclusive checkout");
  await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ migrations: applied.length, checks: checks.length, engine: version, report: destination }));
} finally { await db.close(); }
