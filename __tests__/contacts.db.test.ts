/**
 * Contacts, tested against a real Postgres: the migration, the contact and
 * question bookkeeping the worker relies on, and the routes the dashboard
 * calls. Races and constraints only show up in a real database, so this suite
 * needs one and is skipped without it:
 *
 *   docker run --rm -d -p 55432:5432 -e POSTGRES_PASSWORD=postgres postgres:16
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/postgres \
 *     npx vitest run __tests__/contacts.db.test.ts
 *
 * Each run builds the schema from prisma/migrations inside its own throwaway
 * Postgres schema and drops it at the end, so it never touches existing data.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "../app/generated/prisma/client";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = path.join(__dirname, "..", "prisma", "migrations");
const CONTACTS_MIGRATION = "20260929120000_contacts";

const state = vi.hoisted(() => ({
  db: undefined as unknown as import("../app/generated/prisma/client").PrismaClient,
  workspaceId: "workspace_c",
  role: "OWNER" as "OWNER" | "ADMIN" | "MEMBER",
  queued: [] as { data: { contactIds: string[]; deleted?: boolean } }[],
}));

vi.mock("@/lib/db/client", () => ({
  get prisma() {
    return state.db;
  },
}));
vi.mock("@/lib/auth", () => ({
  getCurrentWorkspaceId: async () => state.workspaceId,
}));
vi.mock("@/lib/workspace-access", () => ({
  canManageWorkspace: (role: string) => role === "OWNER" || role === "ADMIN",
  getCurrentWorkspaceContext: async () => ({
    userId: "user_c",
    workspaceId: state.workspaceId,
    role: state.role,
  }),
}));
vi.mock("@/lib/queue/client", () => ({
  CONTACT_SYNC_JOB_NAME: "sync-contacts",
  getContactSyncQueue: () => ({
    addBulk: async (jobs: { data: { contactIds: string[]; deleted?: boolean } }[]) => {
      state.queued.push(...jobs);
    },
  }),
}));
vi.mock("@/lib/meta/oauth", () => ({
  encryptToken: (value: string) => `enc:${value}`,
  decryptToken: (value: string) => value.replace(/^enc:/, ""),
}));

import {
  claimQuestion,
  findOpenQuestion,
  openQuestion,
  recordFailedAnswer,
  saveContactAnswer,
  trackContact,
} from "../lib/contacts/store";
import { PATCH as updateCampaign, POST as createCampaign } from "../app/api/automations/route";
import { GET as listContacts } from "../app/api/contacts/route";
import { DELETE as deleteContact, PATCH as editContact } from "../app/api/contacts/[id]/route";
import { GET as exportContacts } from "../app/api/contacts/export/route";

const schema = `contacts_${randomBytes(4).toString("hex")}`;
let sql: Client;
const W = "workspace_c";

function migrationDirs() {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function migrationSql(name: string) {
  return readFileSync(path.join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");
}

function jsonRequest(method: string, url: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function idParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function newCampaign(name: string) {
  const campaign = await state.db.automation.create({
    data: {
      workspaceId: W,
      instagramAccountId: "account_c",
      name,
      keywords: ["GUIDE"],
      dmMessage: "Here you go",
      matchAnyPost: true,
    },
  });
  return campaign.id;
}

describe.skipIf(!DATABASE_URL)("contacts on a real Postgres", () => {
  beforeAll(async () => {
    sql = new Client({ connectionString: DATABASE_URL });
    await sql.connect();
    await sql.query(`CREATE SCHEMA "${schema}"`);
    await sql.query(`SET search_path TO "${schema}"`);

    // The database as it was before contacts, with a campaign already in it.
    const dirs = migrationDirs();
    expect(dirs).toContain(CONTACTS_MIGRATION);
    for (const dir of dirs.filter((d) => d < CONTACTS_MIGRATION)) {
      await sql.query(migrationSql(dir));
    }
    await sql.query(`
      INSERT INTO "User" ("id", "email", "updatedAt") VALUES ('user_c', 'contacts@test.dev', now());
      INSERT INTO "Workspace" ("id", "name", "ownerId", "updatedAt") VALUES ('workspace_c', 'Contacts', 'user_c', now());
      INSERT INTO "Workspace" ("id", "name", "ownerId", "updatedAt") VALUES ('workspace_other', 'Other', 'user_c', now());
      INSERT INTO "InstagramAccount" ("id", "workspaceId", "instagramId", "username", "accessToken", "updatedAt")
        VALUES ('account_c', 'workspace_c', 'ig_c', 'brand', 'token', now());
      INSERT INTO "Automation" ("id", "workspaceId", "instagramAccountId", "name", "keywords", "dmMessage", "matchAnyPost", "updatedAt")
        VALUES ('legacy_campaign', 'workspace_c', 'account_c', 'Before contacts', '{LINK}', 'hi', true, now());
    `);
    for (const dir of dirs.filter((d) => d >= CONTACTS_MIGRATION)) {
      await sql.query(migrationSql(dir));
    }

    state.db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: DATABASE_URL }, { schema }),
    });
  }, 60_000);

  afterAll(async () => {
    await state.db?.$disconnect();
    if (sql) {
      await sql.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await sql.end();
    }
  });

  beforeEach(() => {
    state.workspaceId = W;
    state.role = "OWNER";
    state.queued.length = 0;
  });

  describe("the migration", () => {
    it("leaves existing campaigns with every contact setting off", async () => {
      const legacy = await state.db.automation.findUniqueOrThrow({
        where: { id: "legacy_campaign" },
      });
      expect(legacy).toMatchObject({
        askEnabled: false,
        askType: null,
        askMessage: null,
        askAfterLink: false,
        contactTags: [],
      });
    });
  });

  describe("trackContact", () => {
    it("keeps one contact per person and account, with its first campaign and every tag", async () => {
      const first = await newCampaign("First");
      const second = await newCampaign("Second");

      const created = await trackContact({
        workspaceId: W,
        igAccountId: "ig_c",
        igsid: "person_track",
        username: "ana",
        automationId: first,
        tags: ["guide"],
      });
      const again = await trackContact({
        workspaceId: W,
        igAccountId: "ig_c",
        igsid: "person_track",
        inbound: true,
        automationId: second,
        tags: ["guide", " vip "],
      });

      expect(again?.id).toBe(created?.id);
      const contact = await state.db.contact.findUniqueOrThrow({
        where: { id: created!.id },
        include: { tags: { include: { tag: true }, orderBy: { createdAt: "asc" } } },
      });
      expect(contact.username).toBe("ana");
      expect(contact.sourceAutomationId).toBe(first);
      expect(contact.lastInboundAt).not.toBeNull();
      expect(contact.tags.map(({ tag }) => tag.name).sort()).toEqual(["guide", "vip"]);
    });

    it("records a person once when two of their events arrive at the same moment", async () => {
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          trackContact({
            workspaceId: W,
            igAccountId: "ig_c",
            igsid: "person_race",
            tags: ["race"],
          })
        )
      );
      expect(new Set(results.map((r) => r?.id)).size).toBe(1);
      expect(
        await state.db.contact.count({ where: { workspaceId: W, igsid: "person_race" } })
      ).toBe(1);
    });

    it("keeps contacts when their Instagram account is disconnected", async () => {
      await state.db.instagramAccount.create({
        data: {
          id: "account_gone",
          workspaceId: W,
          instagramId: "ig_gone",
          username: "gone",
          accessToken: "token",
        },
      });
      const contact = await trackContact({ workspaceId: W, igAccountId: "ig_gone", igsid: "p" });
      await state.db.instagramAccount.delete({ where: { id: "account_gone" } });
      expect(await state.db.contact.findUnique({ where: { id: contact!.id } })).not.toBeNull();
    });
  });

  describe("questions", () => {
    async function contactWithCampaign(igsid: string) {
      const campaignId = await newCampaign(`Campaign ${igsid}`);
      const contact = await trackContact({ workspaceId: W, igAccountId: "ig_c", igsid });
      return { campaignId, contactId: contact!.id };
    }

    it("counts failed answers and lets exactly one answer claim the question", async () => {
      const { campaignId, contactId } = await contactWithCampaign("person_q1");
      await openQuestion({ contactId, automationId: campaignId, type: "EMAIL", afterLink: false });

      const question = (await findOpenQuestion(contactId))!;
      expect(question).toMatchObject({ type: "EMAIL", attempts: 0, afterLink: false });
      expect(await recordFailedAnswer(question)).toBe(1);

      const claims = await Promise.all([claimQuestion(question), claimQuestion(question)]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      expect(await findOpenQuestion(contactId)).toBeNull();
    });

    it("lets a newer question replace an older one that is still being answered", async () => {
      const { campaignId, contactId } = await contactWithCampaign("person_q2");
      await openQuestion({ contactId, automationId: campaignId, type: "EMAIL", afterLink: false });
      const older = (await findOpenQuestion(contactId))!;
      await new Promise((resolve) => setTimeout(resolve, 5));
      await openQuestion({
        contactId,
        automationId: campaignId,
        type: "TEXT",
        fieldKey: "city",
        afterLink: true,
      });

      expect(await claimQuestion(older)).toBe(false);
      expect(await recordFailedAnswer(older)).toBeNull();
      expect(await findOpenQuestion(contactId)).toMatchObject({ type: "TEXT", fieldKey: "city" });
    });

    it("never replaces another campaign's question while its link waits on the answer", async () => {
      const { campaignId: first, contactId } = await contactWithCampaign("person_q6");
      const second = await newCampaign("Second asker");

      expect(
        await openQuestion({ contactId, automationId: first, type: "EMAIL", afterLink: false })
      ).toBe(true);
      expect(
        await openQuestion({ contactId, automationId: second, type: "PHONE", afterLink: false })
      ).toBe(false);
      expect(await findOpenQuestion(contactId)).toMatchObject({ automationId: first, type: "EMAIL" });

      // Asking again for the same campaign is fine.
      expect(
        await openQuestion({ contactId, automationId: first, type: "EMAIL", afterLink: false })
      ).toBe(true);
    });

    it("lets a question asked after its link give way, since no link waits on it", async () => {
      const { campaignId: first, contactId } = await contactWithCampaign("person_q7");
      const second = await newCampaign("Owes a link");
      await openQuestion({ contactId, automationId: first, type: "TEXT", fieldKey: "city", afterLink: true });

      expect(
        await openQuestion({ contactId, automationId: second, type: "EMAIL", afterLink: false })
      ).toBe(true);
      expect(await findOpenQuestion(contactId)).toMatchObject({ automationId: second });
    });

    it("counts every failed answer when several arrive at once", async () => {
      const { campaignId, contactId } = await contactWithCampaign("person_q8");
      await openQuestion({ contactId, automationId: campaignId, type: "EMAIL", afterLink: false });
      const question = (await findOpenQuestion(contactId))!;

      const counts = await Promise.all([
        recordFailedAnswer(question),
        recordFailedAnswer(question),
        recordFailedAnswer(question),
      ]);
      expect(counts.sort()).toEqual([1, 2, 3]);
    });

    it("waits a week for an email owed a link, and a day for anything else", async () => {
      const { campaignId, contactId } = await contactWithCampaign("person_q9");
      const day = 24 * 60 * 60 * 1000;

      await openQuestion({ contactId, automationId: campaignId, type: "EMAIL", afterLink: false });
      let row = await state.db.contactQuestion.findUniqueOrThrow({ where: { contactId } });
      expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(7 * day);

      await openQuestion({ contactId, automationId: campaignId, type: "EMAIL", afterLink: true });
      row = await state.db.contactQuestion.findUniqueOrThrow({ where: { contactId } });
      expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(day);

      await openQuestion({ contactId, automationId: campaignId, type: "TEXT", fieldKey: "city", afterLink: false });
      row = await state.db.contactQuestion.findUniqueOrThrow({ where: { contactId } });
      expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(day);
    });

    it("drops a question nobody answered in time", async () => {
      const { campaignId, contactId } = await contactWithCampaign("person_q3");
      await openQuestion({ contactId, automationId: campaignId, type: "PHONE", afterLink: false });
      await state.db.contactQuestion.update({
        where: { contactId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect(await findOpenQuestion(contactId)).toBeNull();
      expect(await state.db.contactQuestion.count({ where: { contactId } })).toBe(0);
    });

    it("drops a deleted campaign's questions but keeps the contacts it brought in", async () => {
      const campaignId = await newCampaign("Deleted later");
      const contact = await trackContact({
        workspaceId: W,
        igAccountId: "ig_c",
        igsid: "person_q4",
        automationId: campaignId,
      });
      await openQuestion({
        contactId: contact!.id,
        automationId: campaignId,
        type: "EMAIL",
        afterLink: false,
      });

      await state.db.automation.delete({ where: { id: campaignId } });

      expect(await findOpenQuestion(contact!.id)).toBeNull();
      const kept = await state.db.contact.findUniqueOrThrow({ where: { id: contact!.id } });
      expect(kept.sourceAutomationId).toBeNull();
    });

    it("keeps answers on the contact, one field at a time", async () => {
      const { contactId } = await contactWithCampaign("person_q5");
      await saveContactAnswer({ contactId, type: "EMAIL", fieldKey: null, value: "ana@example.com" });
      await saveContactAnswer({ contactId, type: "PHONE", fieldKey: null, value: "+5491123456789" });
      await saveContactAnswer({ contactId, type: "TEXT", fieldKey: "city", value: "Rosario" });
      await saveContactAnswer({ contactId, type: "TEXT", fieldKey: "size", value: "M" });

      const contact = await state.db.contact.findUniqueOrThrow({ where: { id: contactId } });
      expect(contact).toMatchObject({
        email: "ana@example.com",
        phone: "+5491123456789",
        fields: { city: "Rosario", size: "M" },
      });
    });
  });

  describe("the campaign API", () => {
    const base = {
      instagramAccountId: "account_c",
      matchAnyPost: true,
      keywords: ["GUIDE"],
      dmMessage: "Here you go",
    };

    it("saves a free-text question, creating its field and the campaign's tags", async () => {
      const res = await createCampaign(
        jsonRequest("POST", "http://localhost/api/automations", {
          ...base,
          name: "Ask city",
          askEnabled: true,
          askType: "TEXT",
          askMessage: "Which city are you in?",
          askFieldLabel: "Ciudad de envío",
          askAfterLink: true,
          askThanksMessage: "Thanks!",
          contactTags: [" october ", "vip", "vip"],
        })
      );
      expect(res.status).toBe(201);
      const { id } = (await res.json()).data;

      const campaign = await state.db.automation.findUniqueOrThrow({ where: { id } });
      expect(campaign).toMatchObject({
        askEnabled: true,
        askType: "TEXT",
        askFieldKey: "ciudad_de_envio",
        askAfterLink: true,
        askThanksMessage: "Thanks!",
        askRetryMessage: null,
        contactTags: ["october", "vip"],
      });
      expect(
        await state.db.contactField.findUnique({
          where: { workspaceId_key: { workspaceId: W, key: "ciudad_de_envio" } },
        })
      ).toMatchObject({ label: "Ciudad de envío" });
      expect(
        await state.db.tag.count({ where: { workspaceId: W, name: { in: ["october", "vip"] } } })
      ).toBe(2);

      // Turning the question off clears it; the tags stay.
      const off = await updateCampaign(
        jsonRequest("PATCH", `http://localhost/api/automations?id=${id}`, { askEnabled: false })
      );
      expect(off.status).toBe(200);
      expect(await state.db.automation.findUniqueOrThrow({ where: { id } })).toMatchObject({
        askEnabled: false,
        askType: null,
        askMessage: null,
        askFieldKey: null,
        contactTags: ["october", "vip"],
      });
    });

    it("refuses a question after the link that can't share a message with it", async () => {
      const res = await createCampaign(
        jsonRequest("POST", "http://localhost/api/automations", {
          ...base,
          name: "Too long",
          dmMessage: "x".repeat(550),
          askEnabled: true,
          askType: "EMAIL",
          askMessage: "Could you leave your email so I can send you the next guide too?",
          askAfterLink: true,
        })
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain("600 characters");
    });

    it("refuses a question without a message, or a field named like a built-in column", async () => {
      const noMessage = await createCampaign(
        jsonRequest("POST", "http://localhost/api/automations", {
          ...base,
          name: "No message",
          askEnabled: true,
          askType: "EMAIL",
          askMessage: "  ",
        })
      );
      expect(noMessage.status).toBe(400);

      const reserved = await createCampaign(
        jsonRequest("POST", "http://localhost/api/automations", {
          ...base,
          name: "Reserved",
          askEnabled: true,
          askType: "TEXT",
          askMessage: "Your email?",
          askFieldLabel: "Email",
        })
      );
      expect(reserved.status).toBe(400);
      expect((await reserved.json()).error).toContain("already a contact column");
    });
  });

  describe("the contacts API", () => {
    let contactId = "";

    beforeAll(async () => {
      if (!DATABASE_URL) return;
      const contact = await trackContact({
        workspaceId: W,
        igAccountId: "ig_c",
        igsid: "person_api",
        username: "bruno",
        tags: ["api"],
      });
      contactId = contact!.id;
      await saveContactAnswer({ contactId, type: "EMAIL", fieldKey: null, value: "bruno@example.com" });
      await state.db.contactField.upsert({
        where: { workspaceId_key: { workspaceId: W, key: "city" } },
        create: { workspaceId: W, key: "city", label: "City" },
        update: {},
      });
    });

    it("lists and filters contacts", async () => {
      const tag = await state.db.tag.findUniqueOrThrow({
        where: { workspaceId_name: { workspaceId: W, name: "api" } },
      });
      const res = await listContacts(
        new NextRequest(`http://localhost/api/contacts?q=BRUNO&has=email&tag=${tag.id}`)
      );
      const body = await res.json();
      expect(body.data.pagination.total).toBe(1);
      expect(body.data.contacts[0]).toMatchObject({
        id: contactId,
        email: "bruno@example.com",
        instagramAccount: "brand",
        tags: [{ id: tag.id, name: "api" }],
      });

      const none = await listContacts(new NextRequest("http://localhost/api/contacts?q=nobody-at-all"));
      expect((await none.json()).data.pagination.total).toBe(0);
    });

    it("edits a contact, replacing its tags and clearing emptied values", async () => {
      const bad = await editContact(
        jsonRequest("PATCH", `http://localhost/api/contacts/${contactId}`, { email: "not-an-email" }),
        idParams(contactId)
      );
      expect(bad.status).toBe(400);

      const res = await editContact(
        jsonRequest("PATCH", `http://localhost/api/contacts/${contactId}`, {
          email: "",
          phone: "11 2345-6789",
          fields: { city: "Córdoba", unknown_field: "ignored" },
          tags: ["customer"],
        }),
        idParams(contactId)
      );
      expect(res.status).toBe(200);

      const contact = await state.db.contact.findUniqueOrThrow({
        where: { id: contactId },
        include: { tags: { include: { tag: true } } },
      });
      expect(contact.email).toBeNull();
      expect(contact.phone).toBe("1123456789");
      expect(contact.fields).toEqual({ city: "Córdoba" });
      expect(contact.tags.map(({ tag }) => tag.name)).toEqual(["customer"]);
    });

    it("downloads the contacts as CSV and Excel", async () => {
      const csv = await exportContacts(
        new NextRequest("http://localhost/api/contacts/export?format=csv&q=bruno&tz=America/Argentina/Buenos_Aires")
      );
      expect(csv.headers.get("content-type")).toContain("text/csv");
      const text = await csv.text();
      const [header, row] = text.replace(/^﻿/, "").trim().split("\r\n");
      // Every custom field is a column, in the order the fields were created:
      // "Ciudad de envío" comes from the campaign API test above.
      expect(header).toBe(
        "Contact ID,Instagram account,Instagram user ID,Username,Email,Phone,Ciudad de envío,City,Tags,Source campaign,First seen,Last interaction"
      );
      expect(row).toContain(`${contactId},brand,person_api,bruno,,1123456789,,Córdoba,customer,`);

      const xlsx = await exportContacts(new NextRequest("http://localhost/api/contacts/export"));
      expect(xlsx.headers.get("content-disposition")).toMatch(/attachment; filename="contacts-\d{4}-\d{2}-\d{2}\.xlsx"/);
      const bytes = Buffer.from(await xlsx.arrayBuffer());
      expect(bytes.subarray(0, 2).toString()).toBe("PK");
    });

    it("lets only owners and admins change contacts", async () => {
      state.role = "MEMBER";
      const res = await editContact(
        jsonRequest("PATCH", `http://localhost/api/contacts/${contactId}`, { tags: [] }),
        idParams(contactId)
      );
      expect(res.status).toBe(403);
      const del = await deleteContact(
        jsonRequest("DELETE", `http://localhost/api/contacts/${contactId}`),
        idParams(contactId)
      );
      expect(del.status).toBe(403);
    });

    it("never touches another workspace's contact", async () => {
      state.workspaceId = "workspace_other";
      const res = await deleteContact(
        jsonRequest("DELETE", `http://localhost/api/contacts/${contactId}`),
        idParams(contactId)
      );
      expect(res.status).toBe(404);
      expect(await state.db.contact.count({ where: { id: contactId } })).toBe(1);
    });

    it("deletes a contact and asks the synced sheet to drop its row", async () => {
      await state.db.contactSync.create({
        data: {
          workspaceId: W,
          url: "https://script.google.com/macros/s/x/exec",
          secret: "enc:s",
          enabled: true,
        },
      });

      const res = await deleteContact(
        jsonRequest("DELETE", `http://localhost/api/contacts/${contactId}`),
        idParams(contactId)
      );
      expect(res.status).toBe(200);
      expect(await state.db.contact.count({ where: { id: contactId } })).toBe(0);
      expect(state.queued).toEqual([
        { name: "sync-contacts", data: { workspaceId: W, contactIds: [contactId], deleted: true } },
      ]);
    });
  });
});
