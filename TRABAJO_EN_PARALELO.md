# Trabajo en paralelo con Claude y Codex

Versión 2026-10-17. Acuerdo de Felipe del 17/10/2026: organizar el ecosistema para trabajar con varios agentes en un mismo proyecto, dividiendo el trabajo por ramas. Este documento define el procedimiento común; las instrucciones y autorizaciones propias de cada proyecto siguen vigentes.

## Regla de trabajo

- Una tarea concreta, un agente escritor, una rama de tarea y un checkout exclusivo. Para dos agentes que editan simultáneamente hacen falta worktrees o clones distintos; cambiar de rama dentro de una carpeta compartida no los aísla.
- Otro agente puede revisar en solo lectura. Para editar, debe recibir otra tarea con su propio checkout o un traspaso explícito cuando el escritor anterior haya dejado de trabajar.
- Respetar ramas, checkouts y tareas existentes. No renombrarlos, moverlos ni reasignarlos para ajustarlos retroactivamente a esta guía. Crear aislamiento cuando una tarea real lo necesite; esta política no crea ramas por anticipado.
- Cada repositorio conserva su identidad, stack, documentación, pruebas y destino de integración. Una carpeta sin Git necesita áreas de edición acordadas y consolidación manual; no convertirla en repositorio automáticamente.

## Antes de empezar

1. Verificar la ruta real del proyecto y leer `AGENTS.md`, `CLAUDE.md`, instrucciones anidadas aplicables y memoria canónica. Consultar el estado para retomar y las restricciones de publicación y datos.
2. Revisar el estado local, ramas y worktrees. Identificar cambios del usuario o de otros agentes y operaciones en curso antes de elegir dónde escribir.
3. Elegir explícitamente la referencia base y registrar su SHA y fecha. Puede ser la rama operativa, una rama de funcionalidad u otra acordada: no asumir `main`, `master`, `origin` ni que una referencia local refleja hoy al remoto.
4. Definir tarea, alcance, escritor, checkout y responsable de integración. Cuando haya dependencias entre tareas, registrar el orden y la base de cada una.
5. Reutilizar un checkout adecuado si está libre y corresponde a la tarea. Si otro agente lo usa, preparar un worktree o clon separado sin alterar su carpeta.

Comprobación local de ejemplo, sólo de lectura; sustituir las rutas y referencias por valores verificados:

```text
git -C "<repo-verificado>" rev-parse --show-toplevel
git -C "<repo-verificado>" status --short --branch
git -C "<repo-verificado>" branch --all --verbose --no-abbrev
git -C "<repo-verificado>" worktree list --porcelain
git -C "<repo-verificado>" rev-parse --git-common-dir
git -C "<repo-verificado>" rev-parse --verify "<base-elegida>^{commit}"
```

Estos comandos no consultan remotos ni demuestran que otro agente haya dejado de escribir. Confirmar la asignación mediante el mecanismo disponible; no suponer comunicación entre chats ni inventar bloqueos automáticos.

## Rama y carpeta de cada tarea

- Para ramas nuevas, usar `codex/<tarea>` con Codex y `claude/<tarea>` con Claude, salvo nombre indicado por el usuario o convención local. Elegir un identificador breve y único; si ya existe, verificar su dueño y propósito antes de reutilizarlo.
- Usar una ruta local distinta por tarea, compatible con las reglas y herramientas del proyecto. No anidar un clon dentro de otro repositorio ni incorporar los proyectos al Git del orquestador.
- No ejecutar `switch`, `checkout`, `reset`, `clean`, stash o cambios equivalentes en la carpeta de otro agente. Un árbol con cambios no se limpia ni se incorpora a la tarea por conveniencia.
- Si la tarea necesita cambios locales previos, acordar cómo transferirlos y registrar su procedencia. Un worktree creado desde un commit no incorpora por sí solo cambios sin commit ni archivos ignorados.

Ejemplo ilustrativo de creación, únicamente para una tarea asignada y después de verificar que la ruta está libre, la rama es nueva y la base es correcta:

```text
git -C "<repo-verificado>" worktree add -b codex/<tarea> "<ruta-local-nueva>" <sha-base-verificado>
```

Para Claude, sustituir el nombre por `claude/<tarea>`. Ante rechazo de Git, revisar la causa; no usar `--force` ni `-B` para ocupar una rama o sobrescribir su referencia.

Codex puede crear worktrees administrados con HEAD separado. Se admite ese inicio si el checkout es exclusivo y se registra su SHA y nombre de tarea previsto. Cuando corresponda producir commits o subir el trabajo, crear la rama en ese mismo checkout, mediante la herramienta disponible y con nombre libre; no tomar una rama ocupada en otro worktree. El comportamiento de Codex se verifica en su [documentación oficial de worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees).

## Registro de asignación y continuidad

Antes de editar código, crear o actualizar `progress/PARALELO-<tarea>.md` dentro del checkout propio. Si el proyecto ya tiene un registro equivalente por tarea, usarlo y dejar su referencia. No forzar una memoria compartida como archivo de escritura simultánea.

```text
Tarea y objetivo:
Fecha, escritor y estado: asignada / en curso / lista para revisar / integrada / pendiente
Repositorio y checkout local verificados:
Rama de tarea o HEAD separado; base y SHA inicial:
Alcance, archivos o módulos previstos y límites:
Dependencias con otras tareas y responsable de integración:
Puertos, procesos, salidas y datos de prueba asignados:
Instrucciones leídas, validación prevista y criterio de finalización:
Al cerrar: cambios, pruebas y resultados, SHA final si existe, pendientes y próximo paso.
```

El registro describe una asignación y evidencia; no bloquea Git, no avisa a otros chats ni prueba actividad en tiempo real. Cada agente actualiza su propio registro. Un handoff debe indicar expresamente si queda trabajo sin commit y quién puede continuar.

## Servicios, puertos y datos

- Antes de iniciar procesos, identificar servicios ya activos y recursos del proyecto. Asignar puertos, salidas, cachés, temporales y volúmenes separados cuando haya ejecuciones paralelas.
- No duplicar bots, consumidores de colas, cron, webhooks o servicios conectados a cuentas reales sólo por abrir otro checkout. Usar el entorno de prueba definido por el proyecto o coordinar una única instancia.
- Declarar la base, esquema o conjunto de datos de prueba de cada tarea. No ejecutar migraciones concurrentes ni pruebas que escriban sobre una base compartida sin coordinación y autorización vigente para ese entorno.
- Los worktrees no garantizan aislamiento de servicios externos. Preparar las variables y dependencias que correspondan a cada checkout, sin copiar credenciales al registro, al cerebro ni al repositorio.

## Integración y cierre

1. El escritor revisa su diff, ejecuta las comprobaciones pertinentes y completa su registro con resultados reales, limitaciones y próximo paso. No incluir cambios ajenos en commits ni afirmar pruebas no ejecutadas.
2. El responsable de integración revisa cada entrega y su orden. Coordina cambios que se superponen; actualizar la base, resolver conflictos y validar la combinación pertenece a esa tarea de integración.
3. Respetar el flujo local de PR, merge, push y publicación y las autorizaciones ya dadas. No pedir nuevamente un permiso vigente; esta guía tampoco concede permisos nuevos de integración o despliegue.
4. Conservar la rama y el checkout hasta verificar que el trabajo y su continuidad están preservados. No borrar worktrees, ramas o archivos pendientes para presentar un estado limpio.
5. Tras integrar, actualizar la memoria canónica del proyecto con el resultado pertinente. El orquestador conserva referencias y acuerdos generales; el detalle permanece en el proyecto.

Los worktrees comparten referencias y configuración Git, aunque tienen HEAD e índice propios. Coordinar operaciones sobre ramas compartidas, remotos y mantenimiento; no hacer `prune`, `repair`, eliminación o reconfiguración como efecto secundario de otra tarea. Referencia técnica: [manual oficial de Git worktree](https://git-scm.com/docs/git-worktree).

## Dropbox, sincronización y otra computadora

- Conservar los originales de Dropbox donde eligió el usuario. Crear los worktrees de tarea fuera de la carpeta sincronizada; si compartir la administración Git situada en Dropbox resulta inadecuado, usar un clon local externo para el trabajo paralelo y registrar la relación, sin mover el original.
- Un worktree sigue vinculado a la administración Git del equipo que lo creó. Para continuar en otra computadora, usar los commits y ramas publicados en el remoto verificado de GitHub y recrear allí el checkout con rutas propias; no copiar enlaces administrativos como mecanismo de continuidad.
- Un cambio sin commit, archivos ignorados, datos y credenciales requieren su mecanismo específico. Dropbox sincronizado no acredita que GitHub tenga los commits, y un push no acredita la sincronización de Dropbox.
- `sincronizar-proyectos` conserva sus órdenes de revisar, cerrar y retomar. Comprobar asignaciones activas antes de mutar; cerrar no integra tareas y retomar no cambia de rama ni resuelve divergencias automáticamente.
- Registrar para revisión cada worktree externo concreto y verificado en el alcance de sincronización; no ampliar el recorrido a todo el perfil. Si no está cubierto, informar que no fue inspeccionado. No reparar ni eliminar checkouts ausentes automáticamente.

## Incorporación y mantenimiento de las copias

La fuente mantenida es `_cerebro/TRABAJO_EN_PARALELO.md` del repositorio del orquestador. Las copias de proyecto pueden vivir como `TRABAJO_EN_PARALELO.md` en su raíz, con acceso desde sus instrucciones; conservar esta fecha y procedencia y revisar diferencias al actualizarlas.

Las rutas de comandos son ejemplos sustituibles. Ningún proyecto necesita una ruta absoluta de esta PC para aplicar la guía: su copia es autocontenida y las decisiones particulares se registran dentro de ese proyecto.

Las sesiones abiertas deben recibir y leer las nuevas directrices explícitamente. Un worktree o clon nuevo recibe la documentación versionada de su base; comprobar si contiene esta política y los cambios de instrucciones. Si faltan, incorporar o copiar sólo las directrices pertinentes, preservando el contrato local y registrando su procedencia; no sobrescribir instrucciones ni copiar secretos.

Mantener una copia en disco no activa agentes, no les transmite mensajes y no publica nada. Comunicar qué copias se actualizaron y qué sesiones, ramas o computadoras quedan pendientes de incorporarlas. Este acuerdo organiza tareas futuras; no constituye una ejecución de sincronización, commit o push.
