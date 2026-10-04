# Continuar OpenReply en otro dispositivo

Estado guardado el **4 de octubre de 2026**. Este archivo resume el trabajo para retomarlo sin depender del historial del chat.

## Proyecto y objetivo

- Repositorio de trabajo: https://github.com/felimatte/openreply
- Rama: `main`. `origin` es este fork; `upstream` es el proyecto original de diwenne.
- Producción: https://openreply-nine-delta.vercel.app
- Demo del editor: https://openreply-nine-delta.vercel.app/demo/flow
- Última revisión de aplicación publicada: `e0d34acfdb661e59ff89c781cc54fe7e21b0f3a2` (2 de octubre de 2026).

El pedido del usuario es seguir mejorando mucho la facilidad de uso y el diseño de los flujos. Las funcionalidades existentes le resultan adecuadas. Priorizar claridad del recorrido, edición de mensajes, conexiones, pruebas y publicación, preservando el comportamiento de las automatizaciones.

## Trabajo terminado

- Editor con vistas **Pasos** y **Mapa**, inserción de pasos en una salida concreta, panel contextual y modo ampliado.
- Catálogo de pasos, plantillas, validaciones, diálogos y simulador de conversación renovados.
- Deshacer/rehacer, atajos y guardado que conserva selección e historial; detección de conflictos entre revisiones.
- Motor de flujos, versiones, preguntas, condiciones, esperas, acciones, seguimiento de enlaces y actividad por paso.
- Next.js y eslint-config-next actualizados a 16.3.8 en el archivo de dependencias bloqueadas.
- Cambios publicados en la web y en el worker; migración `20261001120000_flow_builder` aplicada.

Antes de publicar pasaron **618 tests**, incluyendo 40 pruebas de persistencia contra PostgreSQL temporal, la compilación de producción y lint sin errores (dos advertencias preexistentes). Se verificaron el editor en móvil, las conexiones, el guardado y el recorrido completo del simulador. El simulador no confirma la entrega real de Instagram.

El 4 de octubre se volvió a comprobar: la base y Redis responden, `/api/health` informa estado `ok` y el worker de esta revisión está activo. No había cambios de código pendientes y GitHub ya contenía la revisión publicada.

## Preparar un equipo nuevo

Instalá Git, Node.js 24 y Docker Desktop. Cloná este fork (no el upstream):

```sh
git clone https://github.com/felimatte/openreply.git
cd openreply
git switch main
git pull --ff-only
```

Si ya tenés el repositorio, revisá primero `git status` y conservá cualquier trabajo local antes de actualizarlo.

Copiá `.env.example` a `.env` (`Copy-Item .env.example .env` en PowerShell, `cp .env.example .env` en macOS/Linux). Para desarrollo usá las direcciones locales de PostgreSQL y Redis que trae ese ejemplo. Luego:

```sh
npm ci
docker compose up -d
npm run db:generate
npm run db:migrate
npm run dev
```

Abrí http://localhost:3000/demo/flow para continuar el trabajo de interfaz sin una cuenta de Instagram. Los valores de ejemplo permiten preparar el entorno local; el acceso por email y las integraciones reales necesitan credenciales propias. El worker local se inicia con `npm run worker` en otra terminal cuando sea necesario probarlo con servicios de desarrollo.

Para comprobar cambios: `npm test`, `npm run lint` y `npm run build`. Los tests de persistencia requieren `TEST_DATABASE_URL` apuntando a PostgreSQL de pruebas; sin esa variable se omiten. Nunca usar una base de producción para estos tests.

## Qué está guardado y qué necesita otro mecanismo

- GitHub conserva código, migraciones, tests, documentación y `package-lock.json`.
- `.env`, `.env.worker` y `.env.deploy-values` contienen configuración privada y están excluidos de Git. Para trabajar con servicios reales, recuperá los valores desde sus proveedores o un gestor seguro de credenciales; no los pegues en commits ni en chats.
- Los datos reales permanecen en los servicios de producción; no se exportó ni se agregó una copia de la base al repositorio.
- `node_modules`, `.next*`, el cliente Prisma generado y las imágenes Docker se recrean en el equipo nuevo.
- `progress/` contiene notas y artefactos locales ignorados por Git. Este documento conserva el estado necesario para continuar.
- La demo guarda borradores solamente en ese navegador. Un borrador personalizado se traslada con **Más opciones → Exportar flujo** y se recupera con **Importar flujo** en el nuevo equipo; el contenido del navegador no viaja con Git.

## Producción y worker

La web se despliega en Vercel desde `main`. La compilación de Vercel genera Prisma, aplica migraciones y construye Next.js. Una subida a `main` puede disparar una publicación; revisar los cambios antes de subirlos.

**El worker de producción sigue ejecutándose en Docker Desktop de la computadora original.** Cambiar de dispositivo de desarrollo no lo traslada. Para mantener las automatizaciones, esa computadora y Docker deben seguir encendidos. Pasarlo a otro servidor requiere un despliegue coordinado con las mismas variables de conexión y cifrado.

- Contenedor activo: `openreply-worker`.
- Imagen publicada: `openreply:flows-20261002`.
- Comando directo: `node --import tsx worker/dm-worker.ts`.
- Contenedor previo conservado para recuperación: `openreply-worker-pre-flows-20261002`.
- La web y el worker comparten PostgreSQL, Redis y `ENCRYPTION_KEY`; conservar esa clave para poder leer los tokens ya cifrados.

El comando del contenedor publicado ejecuta Node directamente para recibir las señales de apagado. `docker-compose.worker.yml` todavía describe la variante anterior con `npm run worker`; no asumir que reproduce exactamente el contenedor publicado. No iniciar otro worker conectado a producción solo para desarrollar la interfaz.

## Archivos para retomar

- Leer primero `AGENTS.md` y las guías relevantes en `node_modules/next/dist/docs/` antes de cambiar código Next.js.
- `components/flow-builder.tsx` coordina el editor; `components/flows/` contiene las vistas, controles, simulador y estilos.
- `lib/flows/` contiene definiciones, validaciones y ejecución; `worker/dm-worker.ts` inicia los procesos de automatización.
- `docs/flujos.md` explica las funciones y el despliegue. Algunos nombres de controles corresponden a la interfaz anterior; el código actual es la referencia para las etiquetas.
- `docs/openreply-plan-flujos-reels.md` conserva el plan de producto; contrastarlo con lo ya implementado antes de tratar un punto como pendiente.
- `__tests__/flow-editor.test.ts` cubre edición y conexiones; los tests de motor y persistencia están junto a él en `__tests__/`.

Siguiente foco: continuar las mejoras de UX/UI con pruebas de recorridos completos en el navegador. No quedan cambios de aplicación sin guardar de la sesión anterior.
