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
  en OpenReply; no configurar Meta, comprar servicios, publicar contenido ni
  desplegar por esta autorización de implementación.
- No iniciar worker ni cron. Pruebas de contratos con transporte inyectado;
  migraciones y pruebas de persistencia sólo en base descartable. Una lectura
  controlada de capacidades no modifica proveedores ni reconstruye históricos.
- Validación prevista: generación Prisma, tipos, lint, pruebas y build, más CI
  sobre la punta exacta. El consumidor MUSA acredita su propia CI completa.

## Estado

Fase1 en curso: los lectores internos existentes no son todavía un contrato
analytics para MUSA. Business Discovery y sus permisos efectivos no se han
acreditado; Instagram Login actual no demuestra acceso a otras cuentas.
Se conserva Graph APIv25.0, sin actualización por rutina.

### Avance de implementación (sin publicar)

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
Facebook Login/Business Discovery acreditada. No se añade OAuth ni permisos.

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
de la comprobación real. No hay migraciones, integración ni despliegue autorizado.

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
