# OpenReply — Reels de prueba y flujos desde MUSA

05/11/2026. Escritor: subagente Codex `/root/revisar_contenido`; integración: sesión raíz de MUSA.

- Origen conservado: C:/Users/felip/Desktop/Proyectos/AGENTE ORQUESTADOR/Marca personal/Openreply (main local 2572447; .agents/skill-backups ajeno, sin tocar).
- Base: main remoto verificado con git ls-remote, b3ad9c37121430fd8f64dd9fe9de63b6a382b3f1.
- Checkout exclusivo: C:/Users/felip/.codex/worktrees/openreply-reels-flujos-20261105/Openreply.
- Rama: codex/reels-flujos-20261105.
- Preparación por Git: herramienta Codex no admite sourceRoot externo al workspace; fallback local reversible solicitado por integrador.
- Alcance: contrato compatible de publicación trial, catálogo de flujos publicados por cuenta, clon privado por publicación y activación atómica tras mediaId confirmado. API, pruebas y docs OpenReply; ningún archivo MUSA.
- Autorización: Felipe aprobó maqueta, elegir flujo existente y activarlo automáticamente al publicarse, transmitido por raíz. Merge/deploy/publicación real fuera de alcance.
- Instrucciones: AGENTS del checkout y reglas compartidas AGENTS/CLAUDE/TRABAJO_EN_PARALELO del origen preservadas; leídas coordinar-trabajo, Postgres/Supabase y Context7, documentación Next local de route handlers.
- Recursos: junction node_modules al original; no procesos, puertos, .env, DB, Redis, motores ni proveedores reales. Tests sólo sintéticos; PostgreSQL descartable según disponibilidad.
- Dependencia: raíz implementa consumidor MUSA con mismo contrato. No se modifica fuente Automation al seleccionar su versión.
- Validación prevista: suite focal de políticas/proveedor/ledger/aislamiento; tipos, lint y suite unitaria disponible. Idempotencia legacy, concurrencia y no repetición de POST incierto preservados.
- Estado: en curso, sin commits ni push. Sin integración ni despliegue.

## Entrega local — 05/11/2026

Implementado contrato compatible de trialReel (MANUAL/SS_PERFORMANCE), flowId=FlowVersion.id + flowRevision SHA256 + activateOnPublish:true, excluyentes con campaignId legacy. Meta recibe trial_params objeto JSON; Zernio recibe trialParams sin perder thumbnail ni clave de idempotencia. /accounts anuncia capacidades; no acredita elegibilidad individual de Instagram.

GET /flows aísla cuenta/espacio, enumera versiones publicadas y oculta copias internas. Cada UUID crea campaña y versión propias en la misma transacción del ledger, con configuraciones copiadas y reportes compartidos deshabilitados. La fuente conserva su publicación/estado. Tras mediaId exacto, la transacción final marca published, vincula y activa la copia. GET puede completar FINALIZE sin otro POST a Instagram. Una prueba Meta sin mediaId mantiene published y automatización failed/MEDIA_ID_UNAVAILABLE; no se activa ni se repite el Reel. Legacy campaignId sigue pausado.

Validación final:
- npm run typecheck: correcto.
- npm run lint: correcto.
- npm test: 71 archivos correctos /9 omitidos; 1150 pruebas correctas /76 omitidas. Omisiones requieren PostgreSQL descartable o configuración legacy, no servicios reales.
- Se incorporaron tres casos PostgreSQL al suite musa-publications.db.test.ts existente (CI ya ejecuta ese suite): dos reels del mismo flujo con campañas propias, reintento concurrente del mismo UUID sin copias huérfanas y rechazo por revisión cambiada. No ejecutados localmente porque no hay instancia descartable configurada.
- SQL real PostgreSQL WASM PGlite0.5.15 reutilizado del runtime QA aislado de MUSA: 30 migraciones originales sin cambios +9 comprobaciones correctas. Reserva bloquea activación/retarget/delete, status-first + activación con mediaId exacto funciona en una sola transacción, rollback revierte ambas, commit activa, CAS no repite, fuente intacta y prueba container sin mediaId sigue bloqueando activación. Evidencia evidencia-reels-flujos-20261105/postgres-wasm.json; script scripts/qa-musa-flows-pglite.mjs.
- La prueba WASM acredita DDL y transacciones SQL, no transporte Prisma ni concurrencia entre sesiones independientes. La batería PostgreSQL CI sigue pendiente de push autorizado.
- git diff --check: correcto.

Sin migraciones nuevas, .env, proveedores, bases, motores, Redis ni publicaciones reales. Ningún archivo MUSA modificado. Revisión independiente delegada intentada, no disponible por límite global de agentes; integrador raíz revisó contrato y pidió corregir invariantes de automation (corregidas y probadas).

Estado: lista para revisión/integración por raíz, commit local solicitado por integrador; no push, PR, merge ni despliegue. Esta rama y ruta quedan preservadas. Registro progress ignorado por regla original: se agrega explícitamente con git add -f junto a evidencia sintética.

## Actualización — cadenas de flujos completas y rechazos durables

Felipe pidió también las cadenas completas; prevalece sobre la exclusión temporal propuesta de start_flow. La raíz autorizó máximo cinco aristas (límite actual del engine), 25 Automation distintas, rechazo explícito de ciclos y deduplicación de diamantes. Se copian fuentes/dependencias publicadas aunque estén pausadas; originales permanecen intactos.

- GET /flows conserva el contrato y ahora calcula SHA256 sobre TODAS las versiones/grafos/configuraciones transitivas. Razones específicas: FLOW_DEPENDENCY_CHANGED, FLOW_VERSION_CHANGED, FLOW_INVALID, FLOW_TRIGGER_REQUIRED, FLOW_CHAIN_CYCLE, FLOW_CHAIN_DEPTH_LIMIT y FLOW_CHAIN_SIZE_LIMIT.
- Resolver BFS por capas y dos createMany (Automation + FlowVersion) acotan viajes dentro de transacción. Todos los IDs se generan primero; cada start_flow se reescribe a un ID propio del bundle de esa publicación. Max-depth usa altura de DAG con caché y detección de ciclos, incluyendo el camino largo de diamantes.
- Migración aditiva OpenReply 20261105120000_musa_flow_bundles agrega flowCampaignIds TEXT[] NOT NULL DEFAULT[], validación de pertenencia/tamaño/duplicados/nulls, GIN y snapshots inmutables del bundle/input/root. Reservas protegen configuración completa y versiones de TODAS las copias durante processing/uncertain o publicación sin mediaId exacto. Helper de reserva y API legacy rechazan selección de copias privadas como campaña independiente.
- Finalización bloquea las copias ordenadas y prevalida el conjunto íntegro antes de mutar; vincula sólo raíz al mediaId confirmado y activa todas en una transacción. Dependencias quedan sin post, matchAnyPost=false y dmTriggerEnabled=false: el dispatcher sólo las alcanza mediante start_flow remapeado. Conflicto conserva publicación con todas las copias pausadas.
- FLOW_CHANGED/dependencias/límites inválidos son rechazo antes de copiar o contactar proveedor. Crean ledger failed/DONE con mismo UUID/hash dentro de transacción. Índice único arbitra contra aceptaciones concurrentes: catch relee ganador y valida hash/cuenta/proveedor. No se clasifica HTTP409 como prueba de que nadie publicó, ni se convierten fallos DB desconocidos sin ledger en éxito. Pruebas intercalan fuente cambiada tras primer commit, relectura de ganador y rechazo de payload distinto.

Validación nueva tras terminar capa SQL:
- Tipos y lint: correctos.
- Suite completa: 72 archivos correctos /9 omitidos; 1167 pruebas correctas /77 omitidas.
- Batería focal: 187 correctas /15 PostgreSQL omitidas; incluye cadena copiada/remapeada, fuentes pausadas, hash transitivo, límites/ciclos/diamantes y activación integral o ninguna.
- SQL PostgreSQL WASM PGlite0.5.15: 31 migraciones originales sin cambios +19 comprobaciones correctas. Prueba guarda de configuración y versiones dependientes, membership inmutable, rollback y commit de todo el conjunto, y dependencias activas sin post/DM/any-post. No acredita Prisma real ni concurrencia entre sesiones. Suite Prisma DB agregada para CI, omitida localmente.
- Prueba de typecheck regeneró cliente Prisma en este checkout únicamente. No se cambiaron dependencias ni se copiaron secretos.

Publicación futura requiere aplicar migración OpenReply antes de su procesador compatible con bundles; MUSA necesita su 0074 antes de frontend nuevo. No revertir a procesador de raíz sola con cadenas pendientes. Nada integrado, subido ni desplegado.

## Autorización de publicación y preparación — 05/11/2026

Felipe aprobó la pantalla del primer paso y pidió publicarlo. La sesión raíz autorizó conservar y subir la rama feature para crear PR/CI; todavía NO autorizó ejecutar merge, migración ni despliegue desde este subagente. La revisión independiente final del commit c335cc9 no encontró nuevos hallazgos accionables.

Preparación viva:
- Git remoto main verificado b3ad9c37121430fd8f64dd9fe9de63b6a382b3f1; checkout limpio c335cc9 antes de esta nota.
- CLI Vercel65.2.0 cacheada y sesión personal autorizada verificadas sin extraer tokens. Proyecto openreply/prj_9uqrLmzwUh9YuzsWGSvzfciaby33, team_Meqe8XNgJOelZsANVBCgtdAy; enlace Git felimatte/openreply/main, deployments enabled y autoAssignCustomDomains=true.
- Producción actual observada dpl_99DhP6xLMAnZ9dhvmnLX4yT42BYC READY, código main b3ad9c3, dominio openreply-nine-delta.vercel.app. Es el punto actual para reversión de aplicación, por verificar otra vez al publicar.
- Advertencia operativa: merge main puede aplicar prisma migrate deploy y asignar dominio automáticamente. RESPALDO VERIFICADO ANTES DEL MERGE. --prod --skip-domain también ejecuta migración durante build y requiere respaldo previo.
- Preview de esta rama carece DATABASE_URL/REDIS_URL/ENCRYPTION_KEY (disponibilidad booleana por CLI env run, no valores): push/PR puede disparar preview fallido antes de acceder DB; no usar credenciales Production en Preview para remediarlo.
- Variables Production requeridas existen como Secret; el CLI no puede descargarlas. El original canónico sí conserva .env.local/.env.worker; raíz autorizó usarlos sólo en proceso para comparar identidad y hacer inventario SQL read-only, sin mostrar valores ni copiar archivos.
- Health público: DB/Redis/cola responden, worker sin latido (degraded503). Se conserva el motor apagado; publicar web/procesador no implica iniciar workerDM.
- Backups privados anteriores: carpeta Marca personal/OpenReply-respaldos, snapshotsJSON del25/10 de3.9MB; no incorporarlos a Git. Se prepara respaldo nuevo antes de cualquier migración; raíz lo autorizó sin escrituras DB.

Se sube sólo esta feature y sus fuentes/reporte sintético. Fichas personales de cuentas y respaldo DB quedan fuera del repositorio público. Orden restante coordinado por raíz: PR/CI sobre punta exacta, validar respaldo/destino, merge/despliegue compatibles OpenReply, después0074+MUSA, verificación sin publicaciones/mensajes reales.
