import type { Metadata } from "next";
import LegalShell from "@/components/legal-shell";

export const metadata: Metadata = {
  title: "Privacy Policy - OpenReply",
  description:
    "How OpenReply handles Instagram account data, webhook payloads, billing data, and customer campaign information.",
};

export default function PrivacyPage() {
  return (
    <LegalShell
      title="Privacy Policy"
      description="OpenReply helps businesses send Meta-compliant private replies when people comment on connected Instagram posts or reels."
      updatedAt="September 29, 2026"
    >
      <section>
        <h2 className="text-xl font-bold text-white">Data We Collect</h2>
        <p className="mt-3">
          We collect account email addresses for authentication, workspace and
          billing metadata, connected Instagram account identifiers, encrypted
          Instagram access tokens, campaign settings, webhook payloads,
          comments needed to process campaigns, delivery logs, and operational
          diagnostics.
        </p>
        <p className="mt-3">
          For the people who interact with a connected Instagram account, we
          keep a contact record: their Instagram-scoped ID and username, when
          they interacted, the tags the business assigns, and any email
          address, phone number or answer they choose to send in reply to a
          campaign&apos;s question.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-white">How We Use Data</h2>
        <p className="mt-3">
          We use this data to authenticate users, connect Instagram
          integrations, match comment keywords, send private replies through the
          official Meta APIs, prevent duplicate sends, troubleshoot failures,
          and protect the service.
        </p>
        <p className="mt-3">
          Contact records let the connected business see who it talks to,
          export that list, and, if it chooses to, keep a Google Sheet or
          another tool it connects up to date with it. Contact details are
          shared only with the destination the business configures.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-white">Instagram And Meta Data</h2>
        <p className="mt-3">
          OpenReply does not ask for Instagram passwords, scrape Instagram, or
          use browser automation. Instagram tokens are encrypted at rest and are
          used only to perform actions authorized by the connected business
          account.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-white">Subprocessors</h2>
        <p className="mt-3">
          The production service may use hosting, database, Redis queue, email,
          and observability providers such as Vercel, Railway, PostgreSQL,
          Redis, and Resend. These providers process data only as needed to run
          the service. When a business connects a Google Sheet or another tool
          to its contacts, contact records are sent to that destination on the
          business&apos;s behalf.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-white">Retention And Deletion</h2>
        <p className="mt-3">
          Customers can disconnect Instagram from settings, which removes the
          stored Instagram connection and stops campaigns. For account or data
          deletion, follow the Data Deletion page linked from the footer.
        </p>
        <p className="mt-3">
          Contact records are kept until the business deletes them or its
          workspace is deleted. Anyone who shared details with a business can
          ask that business to delete them.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-white">Contact</h2>
        <p className="mt-3">
          For privacy questions, contact the repository owner through GitHub or
          the support email configured for the hosted OpenReply service.
        </p>
      </section>
    </LegalShell>
  );
}
