# Historias de Instagram programadas en MUSA

- 11/11/2026. Felipe aprobó el cambio y Modo Forja. Escritor de OpenReply: agente OpenReply. Integrador: chat MUSA.
- Origen: felimatte/openreply. Base remota verificada 8f2c73f26f05115ac201c7e3bae06bf28211e7e8. Rama codex/historias-musa-20261111. Checkout exclusivo C:/Users/felip/.codex/worktrees/openreply-historias-20261111/Openreply.
- Alcance: historia con un JPEG o MP4 mediante Meta o Zernio, capacidades por cuenta, copia y activación de flujo por ID publicado, respuestas privadas, pruebas con dobles.
- Dependencias: contrato compartido con el checkout MUSA de historias. Se reutilizan dependencias locales y sólo se generan tipos en este checkout. Sin servicios ni credenciales productivas.

## Entrega local

- OpenReply anuncia `story` y `canAttachStoryFlowOnPublish` sólo al pedir `/accounts?includeStory=1`. La disponibilidad del flujo requiere suscripción y evidencia de permiso de mensajería. La consulta de cuentas anterior conserva su formato.
- Meta recibe un contenedor `STORIES` y Zernio recibe `contentType: story`. Se publica un único recurso. El texto editorial queda en MUSA.
- El flujo se copia con su versión y cadena, con las respuestas públicas deshabilitadas en la copia. Sólo se activa cuando el proveedor confirma el ID de Instagram. Los eventos de respuesta tienen que coincidir con ese ID, la cuenta y el negocio. Se preservan las continuaciones y se deduplica en PostgreSQL por ID del mensaje. Las respuestas que llegan antes de la confirmación se reintentan durante un máximo de diez minutos.
- `npm test` pasó 1.187 pruebas. TypeScript, ESLint de archivos afectados y `git diff --check` pasaron. `flow-engine.db.test.ts` pasó 7/7 sobre un Postgres descartable con proveedores simulados. Cubre la historia correcta, otra historia, DM genérico, otro negocio o cuenta, espera de confirmación, duplicado, apertura por DM y continuación.
- La corrida opt-in amplia tuvo ocho fallos reproducidos sobre el árbol original `8f2c73f`: dos en `contacts.db.test.ts` y seis en `tracked-link-order.db.test.ts`. Los fixtures de esas suites no resuelven `musa_flow_copy_reserved(text)` en su esquema. Los cinco timeouts concurrentes de `flow-engine.db.test.ts` desaparecieron al ejecutarlo por separado.
- La activación real queda para un piloto autorizado que confirme el ID de Instagram entre el resultado de publicar y el webhook. Se requiere publicar tanto la web como el worker de OpenReply junto con el soporte correspondiente en MUSA.
