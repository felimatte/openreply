import Link from "next/link";
import FlowBuilder from "@/components/flow-builder";

export default function FlowDemoPage() {
  return <main className="mx-auto max-w-[1600px] px-4 py-6 md:px-8"><div className="mb-6 flex items-center justify-between"><Link href="/" className="font-semibold">OpenReply</Link><Link href="/login" className="rounded-lg border border-border px-4 py-2 text-sm">Conectar mi cuenta</Link></div><FlowBuilder campaignId="demo" demo /></main>;
}
