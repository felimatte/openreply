# Publicación multiformato de MUSA — 25/10/2026

OpenReply ya admite las publicaciones de Reel, imagen y carrusel desde el calendario
de MUSA. El carrusel conserva el orden de entre 2 y 10 imágenes o videos, incluidos
los contenidos mixtos. El contrato anterior de Reel sigue siendo compatible.

Este registro describe la entrega publicada y sus comprobaciones. Guardar esta
documentación no activa envíos ni constituye una autorización para publicar contenido.

## Versión publicada

| Componente | Evidencia de la entrega |
| --- | --- |
| OpenReply | [PR #5 integrado](https://github.com/felimatte/openreply/pull/5) |
| Commit de integración en `main` | `63bd1afbb096f669fecbf7b77191fe2bdad22524` |
| Despliegue de producción | `dpl_48fYb8TrLXe5AHENZf7xb2FthCFt`, estado `READY` |
| Dominio comprobado | [openreply-nine-delta.vercel.app](https://openreply-nine-delta.vercel.app) |
| Entrega complementaria de MUSA | [PR #164 integrado](https://github.com/cociandoia/musa-v2/pull/164) |

La sesión de publicación verificó que el dominio de producción apuntaba al
despliegue indicado y que su origen era el commit de integración señalado. El árbol
de ese commit coincide con el árbol probado del PR. Estas referencias corresponden
a la comprobación del 25 de octubre; no acreditan cambios posteriores del remoto.

## Persistencia y compatibilidad

La migración aditiva `20261025120000_musa_multiformat` quedó aplicada en producción.
Se comprobaron 29 migraciones terminadas, sin migraciones inconclusas. La nueva
lista ordenada de contenedores hijos y las restricciones de confirmación quedaron
presentes y validadas.

El recibo publicado que ya existía se comparó con el respaldo previo: conservó
todos sus valores anteriores y recibió únicamente la nueva lista vacía de hijos.
Los respaldos y cualquier dato real de cuentas se conservan fuera de Git.

Conservar el procesador compatible y el esquema aditivo mientras haya carruseles
procesándose o resultados inciertos. Una publicación incierta requiere revisión;
no corresponde repetirla con otro identificador.

## Comprobaciones registradas

- La [CI del PR #5](https://github.com/felimatte/openreply/actions/runs/40234969933)
  terminó correctamente: migraciones completas en PostgreSQL 17, pruebas de
  integración, tipos, lint y compilación. Esta evidencia corresponde al PR, no a
  una ejecución posterior de CI sobre `main`.
- Las comprobaciones locales previas están en
  [la verificación de implementación](musa-multiformat-validation-2026-10-25.md).
  Sus 67 pruebas omitidas por falta de PostgreSQL local quedaron cubiertas después
  por la CI del PR con base de pruebas.
- La sesión de ensayo posterior registró 137 casos aprobados en 5 suites, con
  Prisma y Meta simulados. Un preload bloqueó las conexiones de red y se propagó
  a los procesos de prueba mediante `NODE_OPTIONS`. El ensayo no prueba una
  publicación real ni las capacidades actuales de una cuenta de Instagram.
- Se verificó que la API de cuentas rechazaba el acceso sin autenticación. No se
  hicieron solicitudes de publicación a la cuenta real como parte del ensayo.
- La base, Redis y la cola respondían correctamente. `/api/health` conservó el
  estado `503` previo porque el worker de mensajes estaba intencionalmente apagado;
  no se inició ningún worker para esta entrega.

La revisión de logs posterior identificó advertencias de dependencias sobre los
modos SSL de PostgreSQL y `url.parse()`. No se identificaron fallos de aplicación
en esos registros revisados.

## Pendientes y límites

La revisión visual de esta entrega sigue pendiente: el control automático bloqueó
el acceso a Microsoft Edge. El usuario autorizó publicar la versión con ese límite.
No presentar el ensayo simulado como una revisión en la sesión real del usuario.

Las capacidades de publicación actuales de Meta deben comprobarse desde el acceso
autorizado de la cuenta antes de un envío real. No se enviaron publicaciones a
Instagram durante el ensayo, ni se activaron campañas o el worker de mensajes.

La vista previa de Vercel carece de `DATABASE_URL` y falla antes de ejecutar las
migraciones. Producción sí terminó en `READY` con su configuración existente. Esta
entrega no cambió las variables del entorno Preview.

## Retomar

Leer el [contrato de publicaciones](musa-publications.md) y la
[integración MUSA](musa.md) antes de cambiar el flujo. Para pruebas técnicas, usar
fixtures y una base de pruebas aislada; conservar el bloqueo de red si se repite
el ensayo simulado. Cualquier prueba real debe tener cuenta, contenido y alcance
expresamente autorizados por el usuario.

El código y las migraciones de esta entrega ya están integrados y publicados.
El cierre de continuidad sólo agrega documentación; no requiere otro despliegue,
una migración adicional ni iniciar el worker.
