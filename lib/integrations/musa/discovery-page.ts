function escape(value: string): string { return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!); }

export function discoveryPage(content: { title: string; message: string; ticket?: string; account?: string; business?: string;
  returnUrl?: string; connectedUntil?: string; status?: number }): Response {
  const form = content.ticket ? `<form method="post" action="/integrations/musa/discovery"><input type="hidden" name="ticket" value="${escape(content.ticket)}">
    <p>Meta te pedirá permiso para leer tu perfil y publicaciones de Instagram, estadísticas, contenido y datos de la Página —incluidos datos de seguidores— y la lista de Páginas que administrás.</p>
    <p>Seleccioná la Página vinculada a esta cuenta. Esta conexión se guarda únicamente para el negocio y la cuenta indicados.</p>
    <button type="submit" name="intent" value="connect">Continuar en Facebook</button>
    ${content.connectedUntil ? '<button type="submit" name="intent" value="revoke" class="secondary">Desconectar esta lectura de Musa</button>' : ""}</form>` : "";
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escape(content.title)} · OpenReply</title><style>body{font-family:system-ui,sans-serif;background:#f7f8fa;color:#20242d;margin:0;padding:24px;line-height:1.6}main{max-width:600px;margin:8vh auto;background:white;border:1px solid #dde1e7;border-radius:20px;padding:32px;overflow-wrap:anywhere}h1{font-size:24px;line-height:1.3}button,a{display:inline-block;margin:12px 12px 0 0}button{background:#5254db;color:white;border:0;border-radius:8px;padding:12px 18px;font:inherit;cursor:pointer}.secondary{background:#edf0f5;color:#20242d}a{color:#4244b5}small{color:#626a78}</style></head>
    <body><main><small>OpenReply · Musa</small><h1>${escape(content.title)}</h1><p>${escape(content.message)}</p>
    ${content.business ? `<p><strong>${escape(content.business)}</strong> · @${escape(content.account ?? "")}</p>` : ""}
    ${content.connectedUntil ? `<p>Autorización guardada hasta ${escape(content.connectedUntil)}. La consulta de competidores todavía requiere su prueba de lectura.</p>` : ""}
    ${form}${content.returnUrl ? `<a href="${escape(content.returnUrl)}">Volver al negocio en Musa</a>` : '<a href="/settings#musa">Volver a OpenReply</a>'}</main></body></html>`, {
    status: content.status ?? 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
      "Referrer-Policy": content.ticket ? "strict-origin" : "no-referrer", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
      // Chromium also checks form-action on the POST's 303 redirect to Meta.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://www.facebook.com; base-uri 'none'; frame-ancestors 'none'" },
  });
}
