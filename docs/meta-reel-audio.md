# Música de Meta para Reels desde OpenReply

## Preparación en Meta for Developers

1. Abrí la app de Facebook que OpenReply ya usa para el consentimiento de Discovery. La app debe tener el caso de uso de Instagram API con Facebook Login y una Página de Facebook vinculada a la cuenta profesional de Instagram del piloto. Usá un perfil de Facebook con acceso a la Página y capacidad de crear contenido.
2. En la configuración de Facebook Login, habilitá el inicio de sesión OAuth del cliente y de la web. Agregá a **Valid OAuth Redirect URIs** la URL absoluta de OpenReply terminada en `/api/instagram/reel-audio/callback`. Por ejemplo, para `NEXTAUTH_URL=https://openreply.example.com`, registrada exactamente como `https://openreply.example.com/api/instagram/reel-audio/callback`, sin barra final.
3. Verificá el acceso de la app a `instagram_basic`, `instagram_content_publish`, `pages_show_list` y `pages_read_engagement`. Para un piloto de roles de app, agregá el perfil de Facebook al rol correspondiente y confirmá su invitación. Para cuentas fuera de esos roles, completá la revisión y habilitá Advanced Access donde Meta lo requiera.
4. En OpenReply reutilizá `FACEBOOK_APP_ID` y `FACEBOOK_APP_SECRET`. El callback se resuelve a partir de `NEXTAUTH_URL`, la versión de API a partir de `META_GRAPH_API_VERSION` y las credenciales se cifran con `ENCRYPTION_KEY`.

## Conexión y verificación

1. Como propietario o administrador del espacio de OpenReply, entrá en **Configuración**, elegí la cuenta profesional y abrí la autorización de música para Reels.
2. En Facebook, aprobá los permisos solicitados y elegí la Página asociada a esa misma cuenta de Instagram.
3. Confirmá que la cuenta figure conectada en Configuración. OpenReply prueba la identidad de la cuenta con Meta y guarda por separado las credenciales de usuario y de Página. El estado muestra autorización vigente guardada. Para validar la disponibilidad real del catálogo y la publicación con música, hace falta una prueba en la cuenta piloto.

Si cambiaron el acceso en Meta o la autorización venció, volvé a conectar la cuenta desde Configuración.

[Instagram API con Facebook Login y tokens de Página](https://www.postman.com/meta/instagram/collection/6yqw8pt/instagram-api) · [Facebook Login y Graph API](https://developers.facebook.com/docs/graph-api/get-started/)
