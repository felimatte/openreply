import type { CampaignTemplate } from "@/lib/templates/campaign-templates";

interface TemplateVisualProps {
  template: CampaignTemplate;
  compact?: boolean;
}

export default function TemplateVisual({
  template,
  compact = false,
}: TemplateVisualProps) {
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <div className="rounded-lg bg-surface p-4">
        <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              Comment trigger
            </p>
            <p className="mt-1 text-sm font-bold text-foreground">
              {template.triggerExample}
            </p>
          </div>
          <span className="rounded-2xl rounded-full border border-border bg-background px-3 py-1 text-xs font-semibold text-muted">
            {template.category}
          </span>
        </div>

        <div className={`grid gap-3 pt-4 ${compact ? "" : "sm:grid-cols-2"}`}>
          <div className="rounded-lg border border-border bg-background p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              Keywords
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {template.keywords.map((keyword) => (
                <span
                  key={keyword}
                  className="rounded-md border border-border bg-surface px-2 py-1 text-xs font-bold text-foreground"
                >
                  {keyword}
                </span>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-background p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              Private reply
            </p>
            <p className="mt-3 text-sm leading-6 text-foreground">
              {template.privateReplyPreview}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
