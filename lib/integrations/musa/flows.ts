import { createHash, randomUUID } from "node:crypto";
import type { Automation, Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { generateReportShareSlug } from "@/lib/reports/share";
import { MusaIntegrationError } from "./errors";
import { requireMusaAccount, type MusaConnectionContext } from "./auth";
import { MAX_MUSA_FLOW_BUNDLE, MAX_MUSA_FLOW_DEPTH, resolveMusaFlowBundle, sourceGraph, subflowIds, type MusaFlowSource } from "./flow-bundle";

const SETTINGS = ["keywords", "excludedKeywords", "priority", "matchAnyWord", "dmMessage", "openingDmEnabled",
  "openingDmMessage", "openingDmButtonLabel", "linkButtonLabel", "requireFollow", "followPromptMessage",
  "followPromptButtonLabel", "followUpEnabled", "followUpMessage", "followUpDelayMinutes", "publicReplyEnabled",
  "publicReplyMessage", "publicReplyMessages", "askEnabled", "askType", "askMessage", "askRetryMessage",
  "askFieldKey", "askAfterLink", "askThanksMessage", "contactTags", "wholeWordMatch"] as const;
const settings = (campaign: Automation) => Object.fromEntries(SETTINGS.map(key => [key, campaign[key]])) as Pick<Automation, typeof SETTINGS[number]>;

export function musaFlowRevision(root: MusaFlowSource, bundle: readonly MusaFlowSource[] = [root]): string {
  const sources = [...bundle].sort((a, b) => a.automation.id.localeCompare(b.automation.id)).map(source => ({
    id: source.id, automationId: source.automation.id, name: source.automation.name,
    publishedVersionId: source.automation.flowPublishedVersionId, definition: source.definition, settings: settings(source.automation),
  }));
  return createHash("sha256").update(JSON.stringify({ version: 2, rootId: root.id, sources })).digest("hex");
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
  const byCampaign = new Map(versions.map(version => [version.automation.id, version]));
  return { version: 1, flows: campaigns.flatMap(campaign => {
    const source = byId.get(campaign.flowPublishedVersionId!);
    if (!source) return [];
    const bundle = resolveMusaFlowBundle(source, byCampaign);
    return [{ id: source.id, name: source.automation.name, revision: musaFlowRevision(source, bundle.sources),
      canAttach: bundle.reason === null, unavailableReason: bundle.reason }];
  }) };
}

async function loadPublicationFlowBundle(tx: Prisma.TransactionClient, context: MusaConnectionContext, accountId: string, flowId: string) {
  const ownership = { workspaceId: context.workspaceId, instagramAccountId: accountId };
  const root = await tx.flowVersion.findFirst({ where: { id: flowId, workspaceId: context.workspaceId,
    automation: ownership }, include: { automation: true } });
  if (!root) throw new MusaIntegrationError(409, "FLOW_CHANGED", "Choose the current published flow again");
  const sources = new Map([[root.automation.id, root]]);
  let frontier = [root];
  for (let depth = 0; frontier.length && depth <= MAX_MUSA_FLOW_DEPTH; depth++) {
    const ids = [...new Set(frontier.flatMap(source => {
      const graph = sourceGraph(source);
      return graph ? subflowIds(graph).filter(id => !sources.has(id)) : [];
    }))];
    if (!ids.length) break;
    if (sources.size + ids.length > MAX_MUSA_FLOW_BUNDLE)
      throw new MusaIntegrationError(409, "FLOW_CHAIN_SIZE_LIMIT", "The flow chain exceeds the supported size");
    const campaigns = await tx.automation.findMany({ where: { ...ownership, id: { in: ids }, flowPublishedVersionId: { not: null } },
      select: { flowPublishedVersionId: true } });
    frontier = await tx.flowVersion.findMany({ where: { workspaceId: context.workspaceId,
      id: { in: campaigns.flatMap(campaign => campaign.flowPublishedVersionId ? [campaign.flowPublishedVersionId] : []) },
      automation: ownership }, include: { automation: true } });
    frontier.forEach(source => sources.set(source.automation.id, source));
  }
  const bundle = resolveMusaFlowBundle(root, sources);
  if (bundle.reason) throw new MusaIntegrationError(409, bundle.reason, "Choose an available published flow chain");
  return { root, sources: bundle.sources };
}

/** Copy the complete chain under the same transaction as its publication UUID. */
export async function copyMusaPublicationFlow(tx: Prisma.TransactionClient, context: MusaConnectionContext,
  accountId: string, flowId: string, revision: string, story = false) {
  requireMusaAccount(context, accountId);
  const bundle = await loadPublicationFlowBundle(tx, context, accountId, flowId);
  if (musaFlowRevision(bundle.root, bundle.sources) !== revision)
    throw new MusaIntegrationError(409, "FLOW_CHANGED", "Choose the current published flow chain again");
  const ids = new Map(bundle.sources.map(source => [source.automation.id, { campaign: `musa_flow_${randomUUID()}`, version: randomUUID() }]));
  const now = new Date();
  const campaigns = bundle.sources.map(source => {
    const target = ids.get(source.automation.id)!;
    const graph = sourceGraph(source)!;
    const remapped = { ...graph, nodes: graph.nodes.map(node => node.type === "action" && node.data.action === "start_flow"
      ? { ...node, data: { ...node.data, automationId: ids.get(node.data.automationId!)!.campaign } } : node) };
    return { ...settings(source.automation),
      ...(story ? { publicReplyEnabled: false, publicReplyMessage: null, publicReplyMessages: [] } : {}),
      id: target.campaign, name: source.automation.name,
      workspaceId: context.workspaceId, instagramAccountId: accountId, createdAt: now, updatedAt: now,
      isActive: false, postId: null, postUrl: null, pendingNextReel: false, nextReelArmedAt: null,
      matchAnyPost: false, dmTriggerEnabled: false, reportShareSlug: generateReportShareSlug(), reportShareEnabled: false,
      flowDraft: remapped as unknown as Prisma.InputJsonValue, flowDraftRevision: 1, flowEnabled: false, flowPublishedVersionId: target.version,
    } satisfies Prisma.AutomationCreateManyInput;
  });
  await tx.automation.createMany({ data: campaigns });
  await tx.flowVersion.createMany({ data: campaigns.map(campaign => ({ id: campaign.flowPublishedVersionId,
    workspaceId: context.workspaceId, automationId: campaign.id, version: 1, definition: campaign.flowDraft })) });
  const rootId = ids.get(bundle.root.automation.id)!.campaign;
  return { ...campaigns.find(campaign => campaign.id === rootId)!, flowCampaignIds: campaigns.map(campaign => campaign.id) };
}
