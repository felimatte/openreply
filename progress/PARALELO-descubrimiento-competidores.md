# Continuidad del lector de competidores

29/10/2026. Integrador y único escritor: /root. Revisores sólo lectura.
Checkout: C:/Users/felip/.codex/worktrees/metricas-contenido-openreply/Openreply.
Rama: codex/lector-competidores-20261029. Base de esta corrección: 02df7a0fb75014ec5d4fd5445442bdba3d392a41, PR10 abierto.
Alcance: compatibilidad de respuestas documentadas de Meta y diagnóstico cerrado de las etapas de autorización; pruebas de regresión. No se amplían permisos ni se debilita la prueba de identidad.
No iniciar servidores, workers, cron ni bases compartidas. Pruebas locales sin proveedores reales y CI sobre PostgreSQL/Redis descartables.
Instrucciones: AGENTS.md y CLAUDE.md de OpenReply, documentación local Next de route handlers; acuerdo TRABAJO_EN_PARALELO.md de Musa.
Hecho observado: Facebook guardó exactamente cuatro permisos para Felimattee/@felimattee, pero callback retornó 400 después del claim. Error concreto aún no registrado por la versión publicada.
Pruebas previstas: proveedor y callback, typecheck/lint, CI completa y revisión independiente del delta. Integración/publicación pendientes de autorización específica de Felipe.

Cierre de preparación: commit e66ae9791a196dab9556cc07c055c02327410fce, árbol caf6687f9b76d7e48cb041c776885246fb34c8d3. CI40900274449 aprobada (tipos, lint, pruebas PostgreSQL/Redis, build y HTTP). Sesenta pruebas dirigidas locales aprobadas. Revisión independiente sin P1/P2. PR10 listo; publicación aún pendiente de la orden de Felipe, solicitada junto con Musa PR172. No se copió configuración de producción. Facebook guardó el consentimiento; todavía no hay prueba de recepción exitosa en OpenReply ni piloto real.

## Traspaso: destinos de Página autorizados — 29/10/2026

Escritor exclusivo: /root/contrato_openreply_metricas. Integrador: /root.
Base exacta: d73ad630db5ca248fb3f4e9e74c8d8b90e30f4ca (PR10 integrado).
Rama: codex/fix-discovery-page-targets-20261029. Se reutiliza el checkout exclusivo anterior, limpio y traspasado explícitamente.
Alcance: discovery-provider.ts, pruebas dirigidas, documentación de contrato y este registro. Sin migraciones, OAuth nuevo, cambios de permisos, publicaciones ni despliegue.
Evidencia comunicada por el integrador: un token USER vigente con los cuatro permisos devuelve /me/accounts vacío; la lectura directa de la Página autorizada devuelve su cuenta profesional. Los destinos granulares de ambos permisos de Página coinciden; los destinos de Instagram son de otro tipo.
Implementación: sólo si la enumeración completa no encuentra la cuenta, intersectar destinos de pages_show_list y pages_read_engagement, deduplicar y limitar a diez lecturas adicionales de Página en el origen fijo. Exigir exactamente una coincidencia de Instagram y mantener la relectura final. No usar destinos Instagram como Páginas ni nombres de usuario como prueba; errores o cobertura incompleta cierran el flujo.
Conservar sin cambios expiración, scopes efectivos, identidad original y validaciones transaccionales de generación/revocación. Tokens sólo en OpenReply; no registrar payloads ni secretos.
Instrucciones leídas: AGENTS.md, CLAUDE.md, guía local Next de Route Handlers y TRABAJO_EN_PARALELO.md de MUSA.
Procesos/puertos: ninguno. Sólo pruebas simuladas y CI con servicios descartables; no consultar cuentas ni proveedores reales.
Estado: en curso. Validación prevista: regresiones de destinos, ausencia y malformación, límites, ambigüedad, identidad, transporte; tipos/lint y CI completa sobre la punta final. Integración/publicación a cargo de /root.
