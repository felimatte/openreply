import { createHmac } from "node:crypto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockPrisma, mockAddBulk, mockLookup } = vi.hoisted(() => ({
  mockPrisma: {
    contactSync: { findUnique: vi.fn(), updateMany: vi.fn() },
    contact: { findMany: vi.fn() },
    contactField: { findMany: vi.fn() },
    instagramAccount: { findMany: vi.fn() },
  },
  mockAddBulk: vi.fn(),
  mockLookup: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("node:dns/promises", () => ({ lookup: mockLookup }));
vi.mock("@/lib/meta/oauth", () => ({
  decryptToken: (value: string) => value.replace(/^enc:/, ""),
}));
vi.mock("@/lib/queue/client", () => ({
  CONTACT_SYNC_JOB_NAME: "sync-contacts",
  getContactSyncQueue: () => ({ addBulk: mockAddBulk }),
}));

import {
  contactSyncRecord,
  enqueueContactSync,
  postContactSync,
  processContactSyncJob,
  sendContactSyncTest,
  serializeContactSyncPayload,
  signContactSyncBody,
  validateSyncUrl,
  type ContactSyncPayload,
} from "../lib/contacts/sync";

const SHEET_URL = "https://script.google.com/macros/s/abc123/exec";

const storedContact = {
  id: "contact_1",
  igAccountId: "ig_456",
  igsid: "person_1",
  username: "ana",
  email: "ana@example.com",
  phone: "+5491123456789",
  fields: { city: "Rosario", orphan: "kept out", size: 42 },
  createdAt: new Date("2026-09-29T12:00:00.000Z"),
  lastInteractionAt: new Date("2026-09-29T12:05:00.000Z"),
  tags: [{ tag: { name: "guía" } }, { tag: { name: "vip" } }],
  sourceAutomation: { name: "Guide October" },
};

function reply(body: unknown, status = 200) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn(async () => reply({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
  mockLookup.mockReset().mockResolvedValue([{ address: "142.250.79.110", family: 4 }]);
  mockPrisma.contactSync.findUnique.mockResolvedValue({
    workspaceId: "workspace_123",
    url: SHEET_URL,
    secret: "enc:s3cret",
    enabled: true,
  });
  mockPrisma.contactSync.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.contact.findMany.mockResolvedValue([storedContact]);
  mockPrisma.contactField.findMany.mockResolvedValue([{ key: "city", label: "Ciudad" }]);
  mockPrisma.instagramAccount.findMany.mockResolvedValue([
    { instagramId: "ig_456", username: "felimattee" },
  ]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("contactSyncRecord", () => {
  it("flattens a contact into the row the sheet receives", () => {
    expect(
      contactSyncRecord(
        storedContact,
        [{ key: "city", label: "Ciudad" }],
        new Map([["ig_456", "felimattee"]])
      )
    ).toEqual({
      contact_id: "contact_1",
      instagram_account: "felimattee",
      instagram_user_id: "person_1",
      username: "ana",
      email: "ana@example.com",
      phone: "+5491123456789",
      tags: ["guía", "vip"],
      source_campaign: "Guide October",
      first_seen: "2026-09-29T12:00:00.000Z",
      last_interaction: "2026-09-29T12:05:00.000Z",
      // Only defined fields, keyed by the label people see.
      fields: { Ciudad: "Rosario" },
    });
  });

  it("sends every defined field, empty when the contact has none, so the sheet clears it", () => {
    const record = contactSyncRecord(
      storedContact,
      [
        { key: "city", label: "Ciudad" },
        { key: "size", label: "Talle" },
      ],
      new Map()
    );
    expect(record.fields).toEqual({ Ciudad: "Rosario", Talle: "" });
    expect(record.instagram_account).toBe("ig_456");
  });
});

describe("the request body and its signature", () => {
  it("escapes every non-ASCII character so the signed bytes can't be re-encoded", () => {
    const body = serializeContactSyncPayload({
      event: "test",
      sent_at: "ñandú 😀",
      workspace_id: "w",
    });
    expect(body).toMatch(/^[\x20-\x7e]*$/);
    expect(body).toContain("\\u00f1and\\u00fa \\ud83d\\ude00");
    expect(JSON.parse(body).sent_at).toBe("ñandú 😀");
  });

  it("signs with HMAC-SHA256, hex, as Apps Script computes it", () => {
    const body = '{"event":"test"}';
    expect(signContactSyncBody(body, "s3cret")).toBe(
      createHmac("sha256", "s3cret").update(body).digest("hex")
    );
  });

  it("sends the signature in a header and in the URL", async () => {
    const payload: ContactSyncPayload = {
      event: "test",
      sent_at: "2026-09-29T12:00:00.000Z",
      workspace_id: "workspace_123",
    };
    await postContactSync({ url: SHEET_URL, secret: "s3cret", payload });

    const [target, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const body = init.body as string;
    const signature = createHmac("sha256", "s3cret").update(body).digest("hex");
    expect(target.toString()).toBe(`${SHEET_URL}?signature=${signature}`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-OpenReply-Signature"]).toBe(
      `sha256=${signature}`
    );
    expect(JSON.parse(body)).toEqual(payload);
  });
});

describe("postContactSync", () => {
  const payload: ContactSyncPayload = { event: "test", sent_at: "t", workspace_id: "w" };

  it("fails when the sheet rejects the update", async () => {
    fetchMock.mockResolvedValue(reply({ ok: false, error: "bad signature" }));
    await expect(
      postContactSync({ url: SHEET_URL, secret: "s", payload })
    ).rejects.toThrow("The sheet rejected the update: bad signature");
  });

  it("fails on an error status", async () => {
    fetchMock.mockResolvedValue(reply("nope", 500));
    await expect(
      postContactSync({ url: SHEET_URL, secret: "s", payload })
    ).rejects.toThrow("status 500");
  });

  it("requires a Google Sheet to confirm, since a broken script still answers 200", async () => {
    fetchMock.mockResolvedValue(reply("<html>Script function not found: doPost</html>"));
    await expect(
      postContactSync({ url: SHEET_URL, secret: "s", payload })
    ).rejects.toThrow("did not confirm");
  });

  it("accepts any 2xx from other tools", async () => {
    fetchMock.mockResolvedValue(reply("Accepted"));
    await expect(
      postContactSync({ url: "https://hook.eu1.make.com/xyz", secret: "s", payload })
    ).resolves.toBeUndefined();
  });

  it("explains a sheet it could not reach", async () => {
    fetchMock.mockRejectedValue(new Error("connect ETIMEDOUT"));
    await expect(
      postContactSync({ url: SHEET_URL, secret: "s", payload })
    ).rejects.toThrow("Could not reach the sheet (connect ETIMEDOUT)");
  });

  it("follows Apps Script's redirect to its output with a GET", async () => {
    const output = "https://script.googleusercontent.com/macros/echo?user_content_key=abc";
    fetchMock
      .mockResolvedValueOnce(new Response("", { status: 302, headers: { location: output } }))
      .mockResolvedValueOnce(reply({ ok: true }));

    await postContactSync({ url: SHEET_URL, secret: "s", payload });

    const [first, second] = fetchMock.mock.calls as [URL, RequestInit][];
    expect(first[1]).toMatchObject({ method: "POST", redirect: "manual" });
    expect(second[0].toString()).toBe(output);
    expect(second[1]).toMatchObject({ method: "GET", redirect: "manual" });
    expect(second[1].body).toBeUndefined();
  });

  it("never follows a redirect into a private network", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("", {
        status: 302,
        headers: { location: "https://169.254.169.254/latest/meta-data/" },
      })
    );
    await expect(
      postContactSync({ url: "https://hooks.example.com/x", secret: "s", payload })
    ).rejects.toThrow("public https URL");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never sends to a name that points at a private address", async () => {
    mockLookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    await expect(
      postContactSync({ url: "https://innocent.example.com/x", secret: "s", payload })
    ).rejects.toThrow("public https URL");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives up after too many redirects", async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response("", { status: 302, headers: { location: "https://hooks.example.com/again" } })
    );
    await expect(
      postContactSync({ url: "https://hooks.example.com/x", secret: "s", payload })
    ).rejects.toThrow("redirected too many times");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("says so when the sheet's name doesn't exist", async () => {
    mockLookup.mockRejectedValue(Object.assign(new Error("not found"), { code: "ENOTFOUND" }));
    await expect(
      postContactSync({ url: "https://nowhere.example.com/x", secret: "s", payload })
    ).rejects.toThrow("Could not reach the sheet (nowhere.example.com was not found)");
  });
});

describe("processContactSyncJob", () => {
  it("sends the contacts' current state and records the success", async () => {
    await processContactSyncJob({ workspaceId: "workspace_123", contactIds: ["contact_1"] });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.event).toBe("contacts.updated");
    expect(body.contacts).toHaveLength(1);
    expect(body.contacts[0].email).toBe("ana@example.com");
    expect(mockPrisma.contactSync.updateMany).toHaveBeenCalledWith({
      where: { workspaceId: "workspace_123" },
      data: { lastSuccessAt: expect.any(Date) },
    });
  });

  it("asks the sheet to remove deleted contacts", async () => {
    await processContactSyncJob({
      workspaceId: "workspace_123",
      contactIds: ["contact_1"],
      deleted: true,
    });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ event: "contacts.deleted", contact_ids: ["contact_1"] });
    expect(mockPrisma.contact.findMany).not.toHaveBeenCalled();
  });

  it("records the error and throws so the queue retries", async () => {
    fetchMock.mockResolvedValue(reply({ ok: false, error: "sheet is protected" }));

    await expect(
      processContactSyncJob({ workspaceId: "workspace_123", contactIds: ["contact_1"] })
    ).rejects.toThrow("sheet is protected");
    expect(mockPrisma.contactSync.updateMany).toHaveBeenCalledWith({
      where: { workspaceId: "workspace_123" },
      data: {
        lastErrorAt: expect.any(Date),
        lastError: "The sheet rejected the update: sheet is protected",
      },
    });
  });

  it("does nothing once the sync is switched off", async () => {
    mockPrisma.contactSync.findUnique.mockResolvedValue({
      workspaceId: "workspace_123",
      url: SHEET_URL,
      secret: "enc:s3cret",
      enabled: false,
    });
    await processContactSyncJob({ workspaceId: "workspace_123", contactIds: ["contact_1"] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips contacts deleted before the job ran", async () => {
    mockPrisma.contact.findMany.mockResolvedValue([]);
    await processContactSyncJob({ workspaceId: "workspace_123", contactIds: ["gone"] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("sendContactSyncTest", () => {
  it("sends a test event that touches no row", async () => {
    await sendContactSyncTest("workspace_123");
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({
      event: "test",
      sent_at: expect.any(String),
      workspace_id: "workspace_123",
    });
  });

  it("asks for the URL first when there is none", async () => {
    mockPrisma.contactSync.findUnique.mockResolvedValue({ url: null, secret: "enc:s" });
    await expect(sendContactSyncTest("workspace_123")).rejects.toThrow("web app URL");
  });
});

describe("enqueueContactSync", () => {
  it("queues nothing while the sync is off", async () => {
    mockPrisma.contactSync.findUnique.mockResolvedValue({ enabled: false, url: SHEET_URL });
    await enqueueContactSync("workspace_123", ["contact_1"]);
    expect(mockAddBulk).not.toHaveBeenCalled();
  });

  it("splits a big resend into jobs of 200 contacts", async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `c${i}`);
    await enqueueContactSync("workspace_123", ids);
    const jobs = mockAddBulk.mock.calls[0][0] as { data: { contactIds: string[] } }[];
    expect(jobs.map((job) => job.data.contactIds.length)).toEqual([200, 200, 50]);
  });

  it("never throws, so a queue problem can't block a DM", async () => {
    mockAddBulk.mockRejectedValue(new Error("Redis down"));
    await expect(enqueueContactSync("workspace_123", ["contact_1"])).resolves.toBeUndefined();
  });
});

describe("validateSyncUrl", () => {
  it("accepts a public https URL", () => {
    expect(validateSyncUrl(` ${SHEET_URL} `)).toEqual({ ok: true, url: SHEET_URL });
  });

  it.each([
    ["not a url", "full web app URL"],
    ["http://script.google.com/macros/s/abc/exec", "https://"],
    ["https://user:pass@example.com/hook", "user name or password"],
    ["https://localhost/hook", "public"],
    ["https://127.0.0.1/hook", "public"],
    ["https://0x7f.0.0.1/hook", "public"],
    ["https://10.1.2.3/hook", "public"],
    ["https://192.168.0.10/hook", "public"],
    ["https://169.254.169.254/latest/meta-data", "public"],
    ["https://[::1]/hook", "public"],
    ["https://printer.local/hook", "public"],
  ])("rejects %j", (value, reason) => {
    const result = validateSyncUrl(value);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain(reason);
  });
});
