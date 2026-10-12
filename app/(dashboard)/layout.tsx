import { I18nProvider } from "@/lib/i18n/provider";
import { getI18n } from "@/lib/i18n/server";
import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard-shell";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { prisma } from "@/lib/db/client";
import { WorkspaceRequestBoundary } from "@/components/workspace-request-boundary";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("OpenReply - Open source Instagram comment-to-DM automation") };
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { locale } = await getI18n();
  const context = await getCurrentWorkspaceContext();

  if (!context) {
    redirect("/login");
  }

  const workspace = context.workspace;
  const [accounts, user] = await Promise.all([
    prisma.instagramAccount.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { connectedAt: "desc" },
      select: { username: true },
    }),
    prisma.user.findUnique({
      where: { id: context.userId },
      select: { image: true },
    }),
  ]);

  return (
    <I18nProvider locale={locale}>
      <WorkspaceRequestBoundary key={`${context.userId}:${workspace.id}`} userId={context.userId} workspaceId={workspace.id}>
        <DashboardShell
          workspaceName={workspace.name}
          profileImage={user?.image ?? null}
          instagramUsername={accounts[0]?.username ?? null}
          instagramAccountCount={accounts.length}
        >
          {children}
        </DashboardShell>
      </WorkspaceRequestBoundary>
    </I18nProvider>
  );
}
