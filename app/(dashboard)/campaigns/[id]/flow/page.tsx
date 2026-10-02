import FlowBuilder from "@/components/flow-builder";

export default async function CampaignFlowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FlowBuilder campaignId={id} />;
}
