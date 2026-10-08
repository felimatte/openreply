export interface CampaignEntrySettings {
  accountId: string;
  scope: "specific" | "any" | "next";
  postId: string | null;
  matchAnyWord: boolean;
  keywords: string[];
  excludedKeywords: string[];
  priority: number;
  publicReplyEnabled: boolean;
  publicReplyMessages: string[];
}

export function campaignEntryIssues(settings: CampaignEntrySettings) {
  const issues: { target: string; message: string }[] = [];
  if (!settings.accountId) issues.push({ target: "campaign-account", message: "Conectá una cuenta de Instagram." });
  if (settings.scope === "specific" && !settings.postId) issues.push({ target: "campaign-post", message: "Elegí un Reel o prepará el próximo." });
  if (!settings.matchAnyWord) {
    if (!settings.keywords.length) issues.push({ target: "campaign-keywords", message: "Agregá la palabra que activa la respuesta." });
    else if (settings.keywords.length > 10 || settings.keywords.some((word) => word.length > 50)) issues.push({ target: "campaign-keywords", message: "Usá hasta 10 palabras, de hasta 50 caracteres cada una." });
  }
  if (settings.excludedKeywords.length > 20 || settings.excludedKeywords.some((word) => word.length > 50)) issues.push({ target: "excluded-keywords", message: "Usá hasta 20 palabras excluidas, de hasta 50 caracteres cada una." });
  if (!Number.isInteger(settings.priority) || settings.priority < -100 || settings.priority > 100) issues.push({ target: "campaign-priority", message: "La prioridad debe ser un número entero entre -100 y 100." });
  if (settings.publicReplyEnabled && (settings.publicReplyMessages.length > 10 || settings.publicReplyMessages.some((message) => message.trim().length > 1000))) issues.push({ target: "campaign-public-reply", message: "Usá hasta 10 respuestas públicas de 1000 caracteres." });
  return issues;
}
