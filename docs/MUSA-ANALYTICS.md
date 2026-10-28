# Analytics de Contenido para MUSA

Blueprint y demo aprobados por Felipe el 28/10/2026; construcción por etapas
(Build Manual), Codex raíz escritor e integrador. Revisores adicionales sólo de lectura.
El plan completo y el consumidor se conservan en el PR171 de `cociandoia/musa-v2`.

- Base remota verificada: `63bd1afbb096f669fecbf7b77191fe2bdad22524`.
- Checkout exclusivo: `C:/Users/felip/.codex/worktrees/metricas-contenido-openreply/Openreply`.
- Rama: `codex/metricas-contenido-20261028`.
- Alcance: puente autenticado de capacidades, perfil/insights y medios propios;
  contrato normalizado por conexión/cuenta/rango y lectura de competidores sólo
  cuando exista autorización acreditada. Fotos, carruseles y videos del proveedor,
  sin medios ficticios en el producto.
- Conservar concesiones, publicación y automatizaciones existentes. Tokens sólo
  en OpenReply. La autorización inicial de implementación no incluía publicar;
  Felipe autorizó después habilitar los cuatro permisos de Meta y, el 28/10/2026,
  integrar y publicar esta etapa en MUSA y OpenReply. No autoriza compras ni
  publicaciones sociales ni sustituye el consentimiento personal de Facebook.
- No iniciar worker ni cron. Pruebas de contratos con transporte inyectado;
  migraciones y pruebas de persistencia sólo en base descartable. Una lectura
  controlada de capacidades no modifica proveedores ni reconstruye históricos.
- Validación prevista: generación Prisma, tipos, lint, pruebas y build, más CI
  sobre la punta exacta. El consumidor MUSA acredita su propia CI completa.

## Estado

Fase1 implementada y revisada, en preparación de publicación. Business Discovery
y sus permisos efectivos no se han
acreditado; Instagram Login actual no demuestra acceso a otras cuentas.
Se conserva Graph APIv25.0, sin actualización por rutina.

### Implementación y límites

Se agregan rutas de lectura `analytics/account`, `media`, `capabilities` y
`discovery` al puente v1. Verifican concesión y cuenta por petición, perfil del
token antes de entregar datos, límite total8,2s, respuestas acotadas y cursor
cifrado por conexión/generación/cuenta/rango. Account conserva agregados como
`pending_validation` hasta acreditar rango y zona; medios piden `period=lifetime`
y rechazan series ambiguas. El lector aislado de `total_value` no se activa por
tener una respuesta técnicamente válida.
Zernio conserva `lastUpdated`, distingue falta de sincronización de falta de
permiso y declara muestra parcial; no convierte portada/permalink en video.
Discovery devuelve `pending_validation` porque aún no existe una concesión de
Facebook Login/Business Discovery acreditada. Se añadió un flujo independiente
de consentimiento con Facebook, limitado a `instagram_basic`,
`instagram_manage_insights`, `pages_read_engagement` y `pages_show_list`.
Estos permisos quedaron habilitados para prueba en la app Openreply Felipe;
eso no acredita el consentimiento de la cuenta ni la lectura de competidores.

El SDK oficial [Meta25.0.3](https://github.com/facebook/facebook-python-business-sdk/tree/25.0.3/facebook_business/adobjects)
acredita parámetros y formas de respuesta, **no** permisos efectivos, semántica
exacta de agregación ni zona efectiva en las cuentas conectadas.

La configuración local apunta a PostgreSQL no disponible. El CLI encuentra el
proyecto Vercel; sus secretos de producción no se recuperaron. La comprobación
real se hizo después desde la sesión de Felipe, mediante funciones existentes.
No confundir las métricas de automatización del puente vigente con las rutas
analytics nuevas, que todavía requieren un ensayo integrado con MUSA.

Después de que Felipe iniciara sesión se comprobó la UI publicada: @felimattee,
21 publicaciones, 70 seguidores y métricas propias por Reel. El resumen suma
lifetime de posts, no acredita agregados por rango. Abrir Overview puede ejecutar
su capturador histórico existente; no afirmar ausencia garantizada de escrituras.
El GET existente de un post devuelve portada sin media_url: no prometer video
reproducible en todas las filas. Esta evidencia habilita construir el consumidor
propio, no acredita todavía el contrato nuevo ni Discovery.

El consumidor de MUSA agrega persistencia, cola, exportación y rutas de negocio
en PR171. Conserva fechas y cobertura; sólo ofrece comparaciones acreditadas.
Las pruebas simuladas y la CI de ambos repositorios se informan por separado
de la comprobación real. La publicación fue autorizada después; se ejecuta sólo
con CI verde sobre main y respaldo previo a las migraciones.

### Consentimiento y preparación de producción

El consentimiento comprueba la sesión de OpenReply, el propietario y la
concesión de MUSA; utiliza estado de un solo uso, vencimiento y generación.
Sólo acepta la Página vinculada a la cuenta de Instagram esperada, verifica
los permisos efectivos y cifra el token en OpenReply. La revocación global
invalida el flujo y elimina la credencial dentro de la misma transacción.
La interfaz de MUSA informa qué se solicita antes de salir a Meta.

Producción requiere `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`,
`ENCRYPTION_KEY`, `NEXTAUTH_URL`, `MUSA_APP_ORIGIN`, `DATABASE_URL` y
`REDIS_URL`. La devolución de OAuth es
`https://openreply-nine-delta.vercel.app/api/integrations/musa/discovery/callback`.
La migración `20261028180000_musa_discovery_authorization` agrega las tablas del flujo
y credenciales y su revocación; el build de Vercel ejecuta `prisma migrate deploy`.
Por eso el respaldo y la CI de main deben estar acreditados antes del build de
producción. Se conserva el despliegue anterior como punto de reversión de app.

La CI de código `40746031400`, sobre `0e8e7c6`, aprobó 1034 pruebas (40 omisiones
condicionales preexistentes), incluidas 41 del proveedor/consentimiento y cinco
de PostgreSQL real. Estas cinco ejercen el guardado y revocación concurrentes.
También se comprobó localmente la política CSP del formulario. El ensayo real
con Facebook y el piloto de competidores siguen pendientes del consentimiento.

Cada GET al proveedor reserva una unidad atómica en Redis: 1200 por concesión
y 12000 globales por hora UTC, con hasta24 GET por solicitud del puente. Son
presupuestos internos, no cuotas garantizadas por Meta/Zernio. Redis ausente o
no disponible cierra la lectura con503; cuota agotada o throttle del proveedor
responde429 con espera explícita, sin convertirlo en métricas ausentes. Las
claves son independientes de DMs. CI prueba las reservas concurrentes contra
un Redis descartable; localmente ese ensayo requiere MUSA_TEST_REDIS_URL.

## Decisiones de datos

- `null` conserva una ausencia; no convertir métricas omitidas en cero.
- Insights por publicación son acumulados. No sumarlos para presentar actividad
  de cuenta ni personas únicas del período.
- Observaciones antiguas sólo diarias se entregan con precisión diaria y hora
  desconocida. Excluir reconstrucciones del histórico observado.
- Cursor opaco, ligado a conexión, cuenta, rango y vencimiento; no aceptar URLs
  Graph arbitrarias. Cada petición trabaja un lote pequeño y continuable.
- Medios HTTPS del proveedor pueden vencer; su permalink no es una URL de video.
  Portada, reproducción y colección completa tienen capacidades separadas.

