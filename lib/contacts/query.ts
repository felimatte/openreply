import type { Prisma } from "@/app/generated/prisma/client";

export type ContactHasFilter = "email" | "phone";

/**
 * The Contacts page filters, read from a query string: `q` searches username,
 * email, phone and Instagram user ID; `tag` is a tag id; `account` a connected
 * account's Instagram id; `has` keeps contacts with an email or a phone.
 */
export function contactWhere(
  workspaceId: string,
  params: URLSearchParams
): Prisma.ContactWhereInput {
  const q = params.get("q")?.trim().slice(0, 100);
  const tag = params.get("tag");
  const account = params.get("account");
  const has = params.get("has");

  return {
    workspaceId,
    ...(account && account !== "all" ? { igAccountId: account } : {}),
    ...(tag ? { tags: { some: { tagId: tag } } } : {}),
    ...(has === "email" ? { email: { not: null } } : {}),
    ...(has === "phone" ? { phone: { not: null } } : {}),
    ...(q
      ? {
          OR: [
            { username: { contains: q.replace(/^@/, ""), mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            { phone: { contains: q.replace(/[^\d+]/g, "") || q } },
            { igsid: { equals: q } },
          ],
        }
      : {}),
  };
}
