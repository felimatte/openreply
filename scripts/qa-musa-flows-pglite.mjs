/** Original migration DDL in disposable PostgreSQL WASM. No sockets, env, credentials or providers. */
import assert from "node:assert/strict";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = process.argv[2] ? resolve(process.argv[2]) : join(root, "package.json");
const { PGlite } = createRequire(runtime)("@electric-sql/pglite");
const db = new PGlite("memory://"), checks = [];
const check = async (name, operation) => { await operation(); checks.push(name); };
const row = async table => (await db.query(`SELECT * FROM "${table}" WHERE "id"=$1`, [table === "MusaPublication" ? "receipt" : "copy"])).rows[0];
const reserved = operation => assert.rejects(operation, error => error.code === "23514" && /MUSA_PUBLICATION_RESERVED/.test(error.message));
const stamp = "2026-11-05T15:00:00.000Z";
const receiptFinalization = `UPDATE "MusaPublication" SET "status"='published',"stage"='DONE',"publishedAt"=now(),"errorCode"=NULL
  WHERE "id"='receipt' AND "leaseToken"='lease-one'`;
const campaignActivation = `UPDATE "Automation" SET "postId"='exact-media',"postUrl"=NULL,"pendingNextReel"=false,
  "nextReelArmedAt"=NULL,"isActive"=true,"flowEnabled"=true
  WHERE "id"='copy' AND "workspaceId"='workspace' AND "instagramAccountId"='account'
    AND "updatedAt"='${stamp}'::timestamp AND "isActive"=false AND "postId" IS NULL
    AND "matchAnyPost"=false AND "dmTriggerEnabled"=false`;

try {
  const migrations = (await readdir(join(root, "prisma/migrations"), { withFileTypes: true }))
    .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  for (const migration of migrations) await db.exec(await readFile(join(root, "prisma/migrations", migration, "migration.sql"), "utf8"));
  await db.exec(`INSERT INTO "User" ("id","email","updatedAt") VALUES ('owner','qa@example.invalid',now());
    INSERT INTO "Workspace" ("id","name","ownerId","updatedAt") VALUES ('workspace','QA only','owner',now());
    INSERT INTO "InstagramAccount" ("id","workspaceId","instagramId","username","accessToken","updatedAt")
      VALUES ('account','workspace','synthetic-ig','qa_never_connected','synthetic-never-used',now());
    INSERT INTO "Automation" ("id","workspaceId","instagramAccountId","name","keywords","dmMessage","isActive","postId","updatedAt")
      VALUES ('source','workspace','account','Source',ARRAY['GUIA'],'Synthetic',true,'existing-source-media','${stamp}'),
        ('copy','workspace','account','Private copy',ARRAY['GUIA'],'Synthetic',false,NULL,'${stamp}');
    INSERT INTO "FlowVersion" ("id","workspaceId","automationId","version","definition")
      VALUES ('source-version','workspace','source',1,'{"schemaVersion":1}'),('copy-version','workspace','copy',1,'{"schemaVersion":1}');
    UPDATE "Automation" SET "flowPublishedVersionId"='copy-version' WHERE "id"='copy';
    INSERT INTO "MusaPublication" ("id","connectionId","workspaceId","publicationId","accountId","provider",
      "payloadHash","payload","campaignId","campaignUpdatedAt","mediaId","stage","leaseToken","updatedAt")
      VALUES ('receipt','grant','workspace','320c1b61-061c-4d0b-8dac-e0be8a51b5fb','account','META','synthetic-hash',
        '{"flowId":"source-version","activateOnPublish":true}','copy','${stamp}','exact-media','FINALIZE','lease-one',now());`);
  await check("all original migrations and bundle guards apply", () => assert.ok(migrations.includes("20261105120000_musa_flow_bundles")));
  await check("processing reservation blocks premature activation", () => reserved(db.exec(campaignActivation)));
  await check("processing reservation blocks retargeting", () => reserved(db.exec(`UPDATE "Automation" SET "postId"='wrong-media' WHERE "id"='copy'`)));
  await check("processing reservation blocks deletion", () => reserved(db.exec(`DELETE FROM "Automation" WHERE "id"='copy'`)));
  await check("status-first activation succeeds within a transaction and can roll back as a unit", async () => {
    await db.exec("BEGIN");
    await db.exec(receiptFinalization); await db.exec(campaignActivation);
    assert.equal((await row("Automation")).isActive, true);
    await db.exec("ROLLBACK");
    assert.equal((await row("MusaPublication")).status, "processing");
    assert.equal((await row("Automation")).isActive, false);
    assert.equal((await row("Automation")).postId, null);
  });
  await check("exact media binding and activation commit atomically with the published receipt", async () => {
    await db.exec("BEGIN");
    assert.equal((await db.query(receiptFinalization)).affectedRows, 1);
    assert.equal((await db.query(campaignActivation)).affectedRows, 1);
    await db.exec("COMMIT");
    assert.equal((await row("MusaPublication")).status, "published");
    assert.equal((await row("Automation")).postId, "exact-media");
    assert.equal((await row("Automation")).isActive, true);
    assert.equal((await row("Automation")).flowEnabled, true);
  });
  await check("activation CAS cannot run again for an already bound campaign", async () => assert.equal((await db.query(campaignActivation)).affectedRows, 0));
  await check("source flow campaign retains its existing post and activation", async () => {
    const source = (await db.query(`SELECT "postId","isActive" FROM "Automation" WHERE "id"='source'`)).rows[0];
    assert.deepEqual(source, { postId: "existing-source-media", isActive: true });
  });
  await check("exact Meta container proof without a media ID still prevents activation", async () => {
    await db.exec(`UPDATE "Automation" SET "isActive"=false,"flowEnabled"=false,"postId"=NULL WHERE "id"='copy'`);
    await db.exec(`UPDATE "MusaPublication" SET "status"='uncertain',"mediaId"=NULL,"containerId"='container';
      UPDATE "MusaPublication" SET "status"='published',"confirmationContainerId"='container';`);
    await reserved(db.exec(`UPDATE "Automation" SET "isActive"=true WHERE "id"='copy'`));
    await reserved(db.exec(`UPDATE "Automation" SET "postId"='guessed' WHERE "id"='copy'`));
  });
  const rootCopy = "musa_flow_00000000-0000-4000-8000-000000000001";
  const dependency = "musa_flow_00000000-0000-4000-8000-000000000002";
  await db.exec(`INSERT INTO "Automation" ("id","workspaceId","instagramAccountId","name","keywords","dmMessage","isActive","postId","updatedAt")
    VALUES ('${rootCopy}','workspace','account','Bundle root',ARRAY['GUIA'],'Synthetic',false,NULL,'${stamp}'),
      ('${dependency}','workspace','account','Bundle child',ARRAY[]::text[],'Synthetic',false,NULL,'${stamp}');
    INSERT INTO "FlowVersion" ("id","workspaceId","automationId","version","definition")
      VALUES ('bundle-root-version','workspace','${rootCopy}',1,'{"schemaVersion":1}'),
        ('bundle-child-version','workspace','${dependency}',1,'{"schemaVersion":1}');
    UPDATE "Automation" SET "flowPublishedVersionId"=CASE WHEN "id"='${rootCopy}' THEN 'bundle-root-version' ELSE 'bundle-child-version' END
      WHERE "id" IN ('${rootCopy}','${dependency}');
    INSERT INTO "MusaPublication" ("id","connectionId","workspaceId","publicationId","accountId","provider","payloadHash","payload",
      "campaignId","flowCampaignIds","mediaId","stage","leaseToken","updatedAt")
      VALUES ('bundle-receipt','grant','workspace','420c1b61-061c-4d0b-8dac-e0be8a51b5fb','account','META','bundle-hash','{}',
        '${rootCopy}',ARRAY['${rootCopy}','${dependency}'],'bundle-media','FINALIZE','bundle-lease',now());`);
  for (const [name, sql] of [
    ["dependency name/settings remain frozen", `UPDATE "Automation" SET "name"='Changed' WHERE "id"='${dependency}'`],
    ["dependency version pointer remains frozen", `UPDATE "Automation" SET "flowPublishedVersionId"='another-version' WHERE "id"='${dependency}'`],
    ["dependency cannot activate before confirmed media", `UPDATE "Automation" SET "isActive"=true WHERE "id"='${dependency}'`],
    ["dependency deletion remains blocked", `DELETE FROM "Automation" WHERE "id"='${dependency}'`],
    ["published dependency graph is immutable while reserved", `UPDATE "FlowVersion" SET "definition"='{}' WHERE "id"='bundle-child-version'`],
    ["published dependency version cannot be deleted while reserved", `DELETE FROM "FlowVersion" WHERE "id"='bundle-child-version'`],
  ]) await check(name, () => reserved(db.exec(sql)));
  await check("ledger bundle membership is immutable", () => assert.rejects(db.exec(`UPDATE "MusaPublication" SET "flowCampaignIds"=ARRAY['${rootCopy}'] WHERE "id"='bundle-receipt'`),
    error => error.code === "23514" && /MUSA_FLOW_BUNDLE_IMMUTABLE/.test(error.message)));
  await check("bundle membership rejects nulls, duplicates, missing roots and oversized lists", async () => {
    for (const ids of [[rootCopy, null], [rootCopy, rootCopy], [dependency], Array.from({ length: 26 }, (_, i) => `musa_flow_${String(i).padStart(36, '0')}`)])
      assert.equal((await db.query('SELECT "musa_flow_bundle_ids_valid"($1::text[],$2) AS valid', [ids, rootCopy])).rows[0].valid, false);
  });
  const activateBundle = async () => {
    await db.exec(`SELECT "id" FROM "Automation" WHERE "id" IN ('${rootCopy}','${dependency}') ORDER BY "id" FOR UPDATE`);
    await db.exec(`UPDATE "MusaPublication" SET "status"='published',"stage"='DONE' WHERE "id"='bundle-receipt';
      UPDATE "Automation" SET "postId"='bundle-media' WHERE "id"='${rootCopy}';
      UPDATE "Automation" SET "isActive"=true,"flowEnabled"=true WHERE "id" IN ('${rootCopy}','${dependency}');`);
  };
  await check("entire chain activation rolls back with its receipt", async () => {
    await db.exec("BEGIN"); await activateBundle(); await db.exec("ROLLBACK");
    assert.equal((await db.query(`SELECT count(*)::int AS count FROM "Automation" WHERE "id" IN ('${rootCopy}','${dependency}') AND "isActive"=true`)).rows[0].count, 0);
    assert.equal((await db.query(`SELECT "status" FROM "MusaPublication" WHERE "id"='bundle-receipt'`)).rows[0].status, 'processing');
  });
  await check("entire chain activates atomically, while only root targets the exact post", async () => {
    await db.exec("BEGIN"); await activateBundle(); await db.exec("COMMIT");
    const rows = (await db.query(`SELECT "id","postId","isActive","flowEnabled","matchAnyPost","dmTriggerEnabled" FROM "Automation"
      WHERE "id" IN ('${rootCopy}','${dependency}') ORDER BY "id"`)).rows;
    assert.equal(rows[0].postId,'bundle-media'); assert.equal(rows[1].postId,null);
    rows.forEach(copy => { assert.equal(copy.isActive,true); assert.equal(copy.flowEnabled,true); assert.equal(copy.matchAnyPost,false); assert.equal(copy.dmTriggerEnabled,false); });
  });
  const report = { createdAt: new Date().toISOString(), postgres: (await db.query("SELECT version() AS version")).rows[0].version,
    runtimeVersion: JSON.parse(await readFile(join(dirname(createRequire(runtime).resolve("@electric-sql/pglite")), "../package.json"), "utf8")).version,
    migrations, checks, passed: checks.length, limitations: "Direct SQL and original triggers; not Prisma transport or independent-session concurrency." };
  const output = join(root, "progress/evidencia-reels-flujos-20261105");
  await mkdir(output, { recursive: true }); await writeFile(join(output, "postgres-wasm.json"), JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify({ migrations: migrations.length, passed: checks.length, output: join(output, "postgres-wasm.json") }) + "\n");
} finally { await db.close(); }
