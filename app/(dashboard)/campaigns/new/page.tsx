import CampaignBuilder from "@/components/campaign-builder";

export default async function NewCampaignPage({ searchParams }: {
  searchParams: Promise<{ instagramAccountId?: string | string[] }>;
}) {
  const { instagramAccountId } = await searchParams;
  const requestedAccountId = Array.isArray(instagramAccountId) ? instagramAccountId[0] : instagramAccountId;
  return <CampaignBuilder key={requestedAccountId} mode="new" requestedAccountId={requestedAccountId} />;
}
