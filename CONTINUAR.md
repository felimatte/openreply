# Continuar OpenReply en otro dispositivo

Estado actualizado el **9 de octubre de 2026**. Este archivo resume el trabajo para retomarlo sin depender del historial del chat.

## Proyecto y objetivo

- Repositorio de trabajo: https://github.com/felimatte/openreply
- Rama: `main`. `origin` es este fork; `upstream` es el proyecto original de diwenne.
- Producción: https://openreply-nine-delta.vercel.app
- Demo del editor: https://openreply-nine-delta.vercel.app/demo/flow
- Primera revisión con el editor renovado publicada: `e0d34acfdb661e59ff89c781cc54fe7e21b0f3a2` (2 de octubre de 2026). Las mejoras posteriores están en el historial de `main`.

El pedido del usuario es seguir mejorando mucho la facilidad de uso y el diseño de los flujos. Las funcionalidades existentes le resultan adecuadas. Priorizar claridad del recorrido, edición de mensajes, conexiones, pruebas y publicación, preservando el comportamiento de las automatizaciones.

## Trabajo terminado

### Rediseño integral de UX/UI

La interfaz usa ahora superficies claras, grafito, bordes suaves y colores de estado sobrios. Se renovaron navegación, dashboard, campañas, métricas, bandeja, contactos, ajustes, editor de flujos, plantillas públicas y acceso. La barra lateral agrupa las secciones y permite buscar páginas/acciones con Ctrl/⌘ + K. El editor conserva el lienzo libre y agrega acceso directo a pasos con encuadre automático del seleccionado.

Campañas y bandeja protegen contra respuestas atrasadas al cambiar de cuenta. Las mutaciones fallidas conservan el estado y los borradores; los errores ofrecen recuperación. Contactos tiene filtros plegables y tarjetas en móvil. El menú móvil, la búsqueda, los paneles y las vistas previas se revisaron con teclado y recuperación del foco.

El rediseño se integra en `main` para publicarlo, por pedido explícito del usuario, en la aplicación habitual: `https://openreply-nine-delta.vercel.app/campaigns`. No cambia el motor, la base ni el worker; no requiere migración. Se verificaron 694 pruebas (40 de persistencia omitidas sin base de pruebas), tipos y lint; la revisión visual usó datos simulados con todas las solicitudes de la prueba interceptadas. Los archivos y capturas de comprobación están en `progress/ui-review/`. Las rutas temporales `app/ui-review` se eliminaron tras verificar. `/demo` y `/demo/flow` son vistas públicas de prueba; para usar cuentas y campañas reales hay que entrar a `/campaigns` en producción.

La compilación de producción terminó correctamente con `OPENREPLY_BUILD_DIR=.next-ux-review` (la caché `.next` estaba bloqueada por Dropbox). La vista previa compilada quedó disponible en `http://localhost:3001/demo`. Se revisaron seis rutas públicas compiladas en escritorio y móvil, sin errores de navegador ni desbordes horizontales. Los agregados automáticos de caché al `tsconfig.json` se retiraron.

El 9 de octubre se corrigió el acceso desde la demo a Campaigns y las demás secciones privadas: ahora se explica el inicio de sesión y se conserva la página de destino. El proxy cubre todas las secciones privadas y no redirige desde login por la mera existencia de una cookie, evitando bucles con sesiones caducadas. Pasaron 28 pruebas de navegación/i18n, lint, compilación y la comprobación en navegador del enlace, búsqueda rápida y destino con parámetros. La vista previa en el puerto 3001 usa ahora `OPENREPLY_BUILD_DIR=.next-ux-navigation`. No se inició sesión ni se enviaron correos en estas comprobaciones.

### Botón de apertura del 8 de octubre

El primer mensaje admite **un botón de continuación**, con texto y destino editables. El motor consulta seguimiento antes del envío: con seguimiento confirmado envía texto y botón; si no puede confirmarlo, envía el mismo texto más «Respondé ETIQUETA para continuar». La etiqueta escrita toma la misma ruta del botón. La variante se conserva en el paso para la recuperación, y el recorrido espera clic o respuesta antes de los siguientes DM. Los enlaces y las respuestas rápidas se mantienen para mensajes posteriores.

El simulador reproduce ambas variantes según el perfil de prueba. Un rechazo que indique `privateReplyConsumed` o Meta `2/1545133` conserva la reserva y detiene la ejecución para revisión, sin intentar una segunda apertura. No se cambiaron campañas existentes ni se enviaron mensajes de prueba a contactos. 115 pruebas relacionadas aprobadas; tipos y verificaciones de editor/clic/alternativa escrita comprobados.

La entrega requiere web y worker. `openreply-worker` ya usa `openreply:opening-button-20261008`, preparada a partir del runtime instalado con todos los módulos actuales de `lib/flows` y `lib/zernio/client.ts`. Carga de módulos comprobada y `/api/health` confirmó `ok`, worker saludable y hostname `862ad750c5d3`. El contexto sin credenciales queda ignorado en `progress/worker-opening-build`. Respaldo detenido: `openreply-worker-pre-opening-20261008`; ejecutar un solo worker. No requiere migración de datos.

### Revisión del flujo de seguimiento del 8 de octubre

Revisadas dos ejecuciones reales del flujo comentario → saludo → condición de seguimiento → texto, imagen y PDF. Ambas estaban `WAITING / INTERACTION` en el saludo, sin error: todavía no se había evaluado la condición. Seguir la cuenta no abre la ventana de mensajes; hace falta una respuesta al primer DM. No se enviaron mensajes de prueba a contactos ni se modificaron campañas publicadas.

El lienzo, la lista y el inspector ahora distinguen **Al recibir respuesta**, **Si escribe una respuesta** y **Después de enviar**. La apertura y la actividad explican la espera; el simulador la hace visible y permite probar seguimiento desconocido. 51 pruebas de editor, motor y simulador aprobadas, incluyendo entrega de los tres contenidos tras respuesta, no seguidor → botón → nueva comprobación y seguimiento desconocido sin entrega. Tipos y lint dirigido aprobados. No cambia el motor ni requiere reemplazar el worker.

Se propuso cambiar el saludo a una invitación a responder. El usuario confirmó que la respuesta resolvió la espera y luego pidió habilitar un botón de apertura. Las conversaciones ya iniciadas pueden continuar cuando el contacto responda; el nuevo botón se puede agregar al editar y publicar la campaña.

### Personalización de mensajes con / del 8 de octubre

El editor visual abre un menú al escribir `/` en mensajes, preguntas y mensajes de dato inválido. Permite buscar sin distinguir acentos, navegar con flechas, insertar con Enter/Tab o clic, cerrar con Escape y usar el botón “Insertar dato”. Conserva el texto a ambos lados del cursor y el formato `{{campo}}` que ya interpreta el worker. No intercepta barras dentro de URLs o fechas.

Variables ofrecidas: usuario de Instagram (`username`), comentario inicial (`comment`), email/teléfono guardados y campos personalizados del workspace o creados por pasos de captura/asignación del flujo. El **nombre completo del perfil no se importa automáticamente**: `commenterName` es en realidad el usuario de Instagram. El nombre está disponible cuando se guarda en un campo propio, por ejemplo `nombre`. No confundir el perfil de la cuenta conectada (`/me`) con el perfil de la persona.

57 pruebas relacionadas, tipos y lint dirigido aprobados. Verificado en navegador: apertura por `/`, búsqueda, clic/Enter/flechas, cierre con Escape, inserción desde botón, sustitución de usuario/comentario en simulador, descubrimiento de campo `nombre` del flujo y guardado. El simulador ahora también personaliza el mensaje de dato inválido, igual que el motor. No requiere migración ni cambiar el worker.

### Unidades de espera del 8 de octubre

El bloque **Espera** permite elegir segundos, minutos u horas, con accesos a 30 segundos, 5 minutos, 1 hora y 24 horas. La cantidad y la unidad se conservan al guardar y volver a abrir; el lienzo y el simulador muestran la misma duración. Se mantienen las esperas por fecha y el máximo de 7 días. El motor conserva minutos canónicos (incluyendo fracciones para segundos), por lo que no necesita migración ni reemplazar el worker.

Verificado: 97 pruebas de duración, motor, validación, simulador, importación y lienzo; tipos y lint sin errores. En navegador se comprobó segundos/minutos/horas y guardado con recarga. Las pruebas de motor comprueban que 30 segundos y 2 horas no continúan antes de tiempo.

### Comparación pendiente de implementar con Manychat

El usuario pidió por ahora las unidades de tiempo y después comparar posibles mejoras. Prioridades: botón inicial con una alternativa textual previa al envío cuando el destinatario no sea compatible; seleccionar/mover/copiar grupos de cajas y autoordenar; extender los flujos visuales a DM y Stories; tarjetas/carruseles; conversión y abandono directamente en el lienzo. No son faltantes las condiciones, etiquetas, campos, randomizador, derivación humana, versiones o simulador: ya existen.

El botón de apertura está habilitado con una alternativa textual previa al envío cuando no se puede confirmar seguimiento. [Manychat lo permite](https://help.manychat.com/hc/en-us/articles/14281316989724-Instagram-Post-and-Reel-Comments-trigger), pero [Zernio advierte](https://docs.zernio.com/comments/send-private-reply-to-comment) que desde finales de agosto de 2026 Instagram rechaza botones/adjuntos para no seguidores y puede consumir igual la única respuesta privada. No intentar botón y luego reintentar texto. Para quick replies además falta conservar `metadata.quickReplyPayload` en la normalización de Zernio, por lo que no se ofrecen en la apertura.

### Lienzo libre del 8 de octubre

El usuario rechazó la lista fija y pidió cajas móviles como Manychat. El editor ahora abre en **Lienzo**, también al crear campañas. Permite arrastrar cajas completas, conectar/reconectar puntos por arrastre o clic, soltar una salida en el fondo para crear una caja, insertar desde una salida y editar/eliminar líneas. El inspector solo ocupa espacio al seleccionar; flota sobre el lienzo y se adapta a móvil. Zoom, desplazamiento, encuadre y deshacer/rehacer disponibles. La inserción en una posición explícita conserva las demás posiciones.

Probado en navegador: movimiento con conexiones, reconexión de una rama, recuperación con Deshacer, creación desde conector y guardado demo. Móvil a 390 px sin desborde horizontal. Pruebas: 591 generales + 5 del lienzo aprobadas; 40 de persistencia omitidas sin base de pruebas. Compilación de producción, tipos y lint aprobados (dos advertencias previas). Publicado como `423b642` en https://openreply-nine-delta.vercel.app/demo/flow. Docker se recuperó renombrando los directorios de sockets temporales con todos sus procesos detenidos; el worker volvió a funcionar y `/api/health` confirmó estado `ok`. No se borraron datos ni contenedores.


### Mejoras del 7 de octubre incluidas en esta entrega

- Nueva campaña muestra tarjetas con el estado de cuenta, publicación y palabras, y una barra de guardado accesible al desplazarse. Revisar lleva al campo o paso pendiente; los filtros se abren automáticamente cuando contienen un error.
- Cada botón/respuesta rápida tiene su conexión junto al texto, con creación e inserción de pasos desde el panel. Los textos distinguen continuación automática y respuesta escrita.
- Límites de texto visibles, bloques numerados y controles para subir/bajar/quitar. En móvil se puede volver directamente al recorrido desde un paso.
- Esta entrega cambia la interfaz y conserva el formato y el motor. Los cambios de esta fecha se incluyen en la entrega del lienzo libre del 8 de octubre.

Verificación local: **591 pruebas pasaron**; 40 pruebas de persistencia se omitieron porque no se configuró una base de pruebas. Compilación de producción, tipos y lint pasaron; lint conserva las dos advertencias previas de navegación. La creación se comprobó con datos de ejemplo sin escribir campañas reales ni enviar mensajes a Instagram.

### Estado publicado al 4 de octubre

- Editor con vistas **Pasos** y **Mapa**, inserción de pasos en una salida concreta, panel contextual y modo ampliado.
- Catálogo de pasos, plantillas, validaciones, diálogos y simulador de conversación renovados.
- Deshacer/rehacer, atajos y guardado que conserva selección e historial; detección de conflictos entre revisiones.
- Motor de flujos, versiones, preguntas, condiciones, esperas, acciones, seguimiento de enlaces y actividad por paso.
- Next.js y eslint-config-next actualizados a 16.3.8 en el archivo de dependencias bloqueadas.
- Cambios publicados en la web y en el worker; migración `20261001120000_flow_builder` aplicada.
- Creación de campañas actualizada el 4 de octubre: el flujo se ve y se edita desde **Nueva campaña**, antes de guardar. **Cuándo empieza** contiene la entrada; **Guardar borrador** conserva la campaña pausada y **Crear y activar** guarda campaña y primera versión en una transacción. Las campañas por DM y las importaciones conservan el formulario simple.

La última verificación del 4 de octubre pasó **625 tests**, incluyendo 40 pruebas de persistencia contra PostgreSQL temporal, la compilación de producción y lint sin errores (dos advertencias preexistentes). Se comprobó la nueva pantalla en el navegador, su simulador, el guardado con el mensaje personalizado y el ancho móvil de 390 px sin desbordes. También se verificó el guardado pausado y activo contra una base local temporal. El simulador no confirma la entrega real de Instagram.

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

Siguiente foco: recoger la devolución del usuario sobre el lienzo libre de cajas y pulir las interacciones. La demo está en /demo/flow y el mismo lienzo se utiliza desde /campaigns/new. La página temporal de pruebas de creación fue retirada.
