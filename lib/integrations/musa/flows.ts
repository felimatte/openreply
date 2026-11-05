import { createHash, randomUUID } from "node:crypto";
import type { Automation, FlowVersion, Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { flowDefinitionSchema, validateFlowDefinition } from "@/lib/flows/definition";
import { generateReportShareSlug } from "@/lib/reports/share";
import { MusaIntegrationError } from "./errors";
import { requireMusaAccount, type MusaConnectionContext } from "./auth";

// These settings affect the conversation outside its immutable graph.
const SETTINGS = ["keywords", "excludedKeywords", "priority", "matchAnyWord", "dmMessage", "openingDmEnabled",
  "openingDmMessage", "openingDmButtonLabel", "linkButtonLabel", "requireFollow", "followPromptMessage",
  "followPromptButtonLabel", "followUpEnabled", "followUpMessage", "followUpDelayMinutes", "publicReplyEnabled",
  "publicReplyMessage", "publicReplyMessages", "askEnabled", "askType", "askMessage", "askRetryMessage",
  "askFieldKey", "askAfterLink", "askThanksMessage", "contactTags", "wholeWordMatch"] as const;
type FlowSource = FlowVersion & { automation: Automation };
const settings = (campaign: Automation) => Object.fromEntries(SETTINGS.map(key => [key, campaign[key]])) as Pick<Automation, typeof SETTINGS[number]>;

export function musaFlowRevision(source: FlowSource): string {
  return createHash("sha256").update(JSON.stringify({ version: 1, id: source.id, name: source.automation.name,
    publishedVersionId: source.automation.flowPublishedVersionId, definition: source.definition,
    settings: settings(source.automation),
  })).digest("hex");
}

function flowUnavailableReason(source: FlowSource): string | null {
  if (source.automation.flowPublishedVersionId !== source.id) return "FLOW_VERSION_CHANGED";
  if (!source.automation.matchAnyWord && !source.automation.keywords.some(keyword => keyword.trim())) return "FLOW_TRIGGER_REQUIRED";
  return validateFlowDefinition(source.definition).valid ? null : "FLOW_INVALID";
}

export async function listMusaFlows(context: MusaConnectionContext, accountId: string) {
  const account = requireMusaAccount(context, accountId);
  const campaigns = await prisma.automation.findMany({ where: { workspaceId: context.workspaceId,
    instagramAccountId: account.id, flowPublishedVersionId: { not: null }, id: { not: { startsWith: "musa_flow_" } } },
  select: { flowPublishedVersionId: true }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 501 });
  if (campaigns.length > 500) throw new MusaIntegrationError(503, "FLOW_LIST_LIMIT", "The flow list is too large");
  const versions = await prisma.flowVersion.findMany({ where: { workspaceId: context.workspaceId,
    id: { in: campaigns.flatMap(campaign => campaign.flowPublishedVersionId ? [campaign.flowPublishedVersionId] : []) },
    automation: { workspaceId: context.workspaceId, instagramAccountId: account.id } }, include: { automation: true } });
  const byId = new Map(versions.map(version => [version.id, version]));
  return { version: 1, flows: campaigns.flatMap(campaign => {
    const source = byId.get(campaign.flowPublishedVersionId!);
    if (!source) return [];
    const unavailableReason = flowUnavailableReason(source);
    return [{ id: source.id, name: source.automation.name, revision: musaFlowRevision(source),
      canAttach: unavailableReason === null, unavailableReason }];
  }) };
}

/** Copy under the same transaction as the publication UUID; retries cannot create another campaign. */
export async function copyMusaPublicationFlow(tx: Prisma.TransactionClient, context: MusaConnectionContext,
  accountId: string, flowId: string, revision: string) {
  requireMusaAccount(context, accountId);
  const version = await tx.flowVersion.findFirst({ where: { id: flowId, workspaceId: context.workspaceId,
    automation: { workspaceId: context.workspaceId, instagramAccountId: accountId } }, include: { automation: true } });
  if (!version || flowUnavailableReason(version) || musaFlowRevision(version) !== revision)
    throw new MusaIntegrationError(409, "FLOW_CHANGED", "Choose the current published flow again");
  const graph = flowDefinitionSchema.parse(version.definition);
  for (const node of graph.nodes) {
    if (node.type !== "action" || node.data.action !== "start_flow") continue;
    const target = await tx.automation.findFirst({ where: { id: node.data.automationId, workspaceId: context.workspaceId,
      instagramAccountId: accountId, flowEnabled: true, flowPublishedVersionId: { not: null } }, select: { id: true } });
    if (!target) throw new MusaIntegrationError(409, "FLOW_DEPENDENCY_CHANGED", "A subflow is no longer available");
  }
  const id = `musa_flow_${randomUUID()}`, versionId = randomUUID();
  const campaign = await tx.automation.create({ data: { ...settings(version.automation), id,
    name: version.automation.name, workspaceId: context.workspaceId, instagramAccountId: accountId,
    isActive: false, postId: null, postUrl: null, pendingNextReel: false, nextReelArmedAt: null,
    matchAnyPost: false, dmTriggerEnabled: false, reportShareSlug: generateReportShareSlug(), reportShareEnabled: false,
    flowDraft: graph as Prisma.InputJsonValue, flowDraftRevision: 1, flowEnabled: false, flowPublishedVersionId: versionId,
    flowVersions: { create: { id: versionId, workspaceId: context.workspaceId, version: 1, definition: graph as Prisma.InputJsonValue } },
  } });
  return campaign;
}
