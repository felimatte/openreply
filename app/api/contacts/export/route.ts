import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import {
  CONTACT_EXPORT_SELECT,
  contactExportHeader,
  contactExportRow,
  exportDateFormatter,
} from "@/lib/contacts/format";
import { contactWhere } from "@/lib/contacts/query";
import { toCsv } from "@/lib/utils/csv";
import { toXlsx } from "@/lib/utils/xlsx";

export const dynamic = "force-dynamic";

// Far more than a single account collects; keeps one download bounded.
const MAX_EXPORT_ROWS = 50_000;

const CONTENT_TYPES = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/**
 * Download the contacts that match the Contacts page filters, as Excel
 * (`format=xlsx`, the default) or CSV. `tz` is the viewer's time zone, used
 * for the dates in the file.
 */
export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const params = request.nextUrl.searchParams;
  const format = params.get("format") === "csv" ? "csv" : "xlsx";

  const [contacts, fields, accounts] = await Promise.all([
    prisma.contact.findMany({
      where: contactWhere(workspaceId, params),
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: MAX_EXPORT_ROWS,
      select: CONTACT_EXPORT_SELECT,
    }),
    prisma.contactField.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
      select: { key: true, label: true },
    }),
    prisma.instagramAccount.findMany({
      where: { workspaceId },
      select: { instagramId: true, username: true },
    }),
  ]);

  const usernames = new Map(accounts.map((a) => [a.instagramId, a.username]));
  const formatDate = exportDateFormatter(params.get("tz"));
  const rows = [
    contactExportHeader(fields),
    ...contacts.map((contact) =>
      contactExportRow(contact, fields, usernames, formatDate)
    ),
  ];

  const body =
    format === "csv"
      ? new TextEncoder().encode(toCsv(rows))
      : new Uint8Array(toXlsx(rows, "Contacts"));
  const filename = `contacts-${formatDate(new Date()).slice(0, 10)}.${format}`;

  return new NextResponse(body, {
    headers: {
      "Content-Type": CONTENT_TYPES[format],
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
