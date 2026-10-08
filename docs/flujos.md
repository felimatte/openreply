# Flujos de respuestas a comentarios de Reels

Esta guía describe el armador visual implementado en OpenReply. Permite iniciar una conversación desde un comentario, entregar varios mensajes, pedir datos, aplicar etiquetas y elegir caminos. Las funciones pendientes del proyecto están en [el plan de desarrollo](openreply-plan-flujos-reels.md).

## Crear y activar un flujo

1. Entrá en **Nueva campaña**: el flujo aparece directamente, antes de crear o guardar la campaña.
2. Las tarjetas de cuenta, publicación y palabras muestran qué está listo y qué falta. Tocá una tarjeta o **Cuándo empieza** para configurar la entrada. Podés usar **El próximo Reel** para prepararla antes de publicar desde Instagram. Las exclusiones están en **Filtros y prioridad**. **Listo, volver al flujo** cierra ese panel.
3. Personalizá el recorrido inicial o elegí una plantilla. Las plantillas reemplazan el borrador abierto. El **Lienzo** es la vista principal: cada caja se puede arrastrar libremente. **Lista** permite consultar el recorrido en orden.
4. Agregá pasos desde el catálogo o con el **+** de una salida para insertarlos en ese lugar. Seleccioná un paso para editarlo en el panel derecho. Cada botón de continuación tiene su destino en la misma tarjeta: podés elegir uno existente, **Agregar paso** o **Insertar un paso** antes del destino actual. El panel aparece al seleccionar una caja y se cierra con la cruz, también en móvil.
5. Revisá el indicador de puntos pendientes y usá **Probar flujo** para recorrer la conversación sin enviar mensajes reales.
6. La barra de guardado permanece accesible al desplazarte. **Revisar** abre la entrada o señala los pasos pendientes. **Guardar borrador** crea la campaña pausada con el flujo que diseñaste; necesita entrada y campos válidos, aunque las conexiones pueden quedar pendientes. **Crear y activar** guarda la campaña y su primera versión publicada en una sola operación; requiere un flujo completo.

Después de crearla, seguís en el mismo editor. En campañas existentes podés entrar con **Armar flujo** o **Armar flujo visual**, y guardar o publicar nuevas versiones. **Respuesta simple** permite usar el formulario anterior, necesario para campañas iniciadas por un DM. Las importaciones CSV conservan ese modo.

Guardar un borrador admite conexiones pendientes, pero necesita textos, campos y direcciones con un formato válido. La publicación exige todas las salidas necesarias, un inicio y un final alcanzable. Un paso sin conectar aparece señalado. Hay un máximo de 120 pasos por flujo.

El Reel, las palabras, las exclusiones, la prioridad y la respuesta pública se configuran en la campaña. El enlace **Configurar Reel y palabras** permite volver a esa pantalla.

La espera de **Próximo Reel** empieza al activar la campaña. Si estaba pausada y la volvés a activar, busca el primer Reel publicado desde esa nueva activación. Una vez vinculada, conserva el mismo Reel.

## Mover y conectar cajas

- Arrastrá cualquier parte de una caja para cambiar su posición. Las conexiones la acompañan; la posición visual no cambia el orden de ejecución.
- Arrastrá el punto de salida hasta otra caja para conectarla o cambiar el destino existente. También podés tocar el punto y después la caja de destino.
- Soltá un conector en un espacio libre para crear una caja conectada en ese lugar. El **+** de una salida inserta una caja conservando la continuación anterior.
- Doble clic en el fondo o **Nueva caja** agrega un paso independiente. Al agregar en el lienzo, las demás cajas mantienen su posición.
- Tocá una línea para cambiar su destino, insertar una caja o eliminar esa conexión. Deshacer/rehacer recuperan movimientos y conexiones.
- Arrastrá el fondo para desplazarte; los controles inferiores acercan, alejan o muestran todo. Ctrl/⌘ + rueda hace zoom sobre el puntero. Con una caja enfocada, las flechas la mueven (Shift amplía el desplazamiento).
- Guardar conserva las posiciones y el encuadre.

## Cómo empieza la conversación

La respuesta privada inicial a un comentario es **un mensaje de texto sin botones ni archivos**. Pedí una respuesta escrita, por ejemplo:

> ¡Hola! Respondé SI y te envío la guía.

El motor espera una respuesta de la persona antes de enviar los pasos siguientes. En esta versión cualquier respuesta escrita puede continuar la apertura: escribir SI es una instrucción para la persona, no una validación de palabra clave. Para exigir una respuesta concreta, agregá después una pregunta de opciones y conectá sus caminos.

Los siguientes mensajes necesitan una ventana abierta de 24 horas desde la última interacción de la persona. Una respuesta escrita, un botón que continúa el flujo o una respuesta rápida habilitan o renuevan esa ventana. Leer el mensaje y abrir un enlace web no la renuevan. Una espera tampoco la renueva.

La apertura sólo puede enviarse dentro de los siete días desde el comentario original y se limita a una respuesta privada por comentario. El motor comprueba la fecha y el permiso de envío. Si una demora termina con la ventana cerrada, el recorrido puede quedar esperando una nueva interacción; ese estado se ve en **Recorridos**.

## Pasos disponibles

| Paso | Uso | Salidas que hay que revisar |
| --- | --- | --- |
| Comentario de Reel | Inicio del recorrido desde la campaña | Continuar |
| Mensaje | Texto, imagen, video, audio, PDF y botones | Continuación; cada botón que sigue el flujo |
| Pedir un dato | Email, teléfono, texto, número u opciones | Respuesta válida, omitir y sin respuesta |
| Condición | Elegir según datos, etiquetas, seguimiento o clics | Sí y no |
| Espera | Esperar minutos o una fecha y hora | Continuar |
| Acción | Etiquetas, campos, integración, objetivo, pausa, derivación u otro flujo | Continuar; error cuando corresponda |
| Repartir caminos | Distribuir contactos por porcentaje | Cada variante; los porcentajes deben sumar 100 |
| Finalizar | Terminar el recorrido | Ninguna |

### Mensajes, enlaces y respuestas rápidas

Un mensaje admite varios bloques de texto y archivos. Los botones y las respuestas rápidas se usan en un mensaje con **un único bloque de texto**. Elegí botones o respuestas rápidas para ese mensaje.

- Hasta tres botones por mensaje, con títulos de hasta 20 caracteres. Pueden continuar el flujo o abrir una dirección HTTPS.
- Hasta once respuestas rápidas en el editor, todas para continuar el flujo.
- Texto de hasta 1000 bytes UTF-8 por bloque. Los emojis y las letras con acento pueden ocupar varios bytes.
- El texto con botones también debe tener como máximo 640 caracteres. Dividí un texto extenso en mensajes anteriores y dejá el último con los botones.

Un mensaje con botones de continuación espera una elección. La salida **Continuar / respuesta escrita** define qué sucede con una respuesta que no coincide con un botón. Si no se configura y hay un único botón de continuación, una respuesta escrita puede usar ese camino. Con varios botones, la persona puede tocar uno o escribir su título.

La vista de pasos distingue **Si responde con texto** de **Al enviar el mensaje**. Los mensajes posteriores sin opciones de continuación avanzan automáticamente. El panel de edición muestra los límites de texto y de espacio UTF-8 junto al campo; los emojis y acentos ocupan más espacio. Los avisos conservan el texto para que puedas corregirlo.

Los botones web registran clics por recorrido y no bloquean los pasos siguientes. Para esperar una respuesta antes de avanzar, usá un botón de continuación o una pregunta.

### Variables y campos

Podés personalizar textos con `{username}`, `{email}`, `{phone}` y cualquier campo guardado, por ejemplo `{interes}`. El texto original del comentario está disponible como `{comment}`. También se admite `{{username}}` y un valor alternativo como `{{interes|tu recurso}}`. Un campo ausente sin valor alternativo se muestra vacío.

Para guardar respuestas, usá nombres de campo con letras, números y guiones bajos, empezando por una letra. `username` y `comment` están reservados. Para guardar el email o teléfono en su columna habitual, elegí esos tipos y los campos `email` o `phone`.

Una pregunta puede intentar validar de una a cinco veces y esperar entre uno y 10080 minutos. El editor admite hasta diez opciones. El contacto puede omitir; al agotar los intentos también sigue la salida **Omitir**. El vencimiento usa **Sin respuesta**. Conectá los tres caminos, aunque varios terminen en el mismo paso.

### Condiciones

Elegí si deben cumplirse todas las reglas o alguna. Los campos especiales son:

| Campo | Valor de ejemplo | Comportamiento |
| --- | --- | --- |
| `tag` | `Interesado` | Comprueba esa etiqueta completa, sin diferenciar mayúsculas |
| `follows` | `true`, `false`, `unknown` | La API puede no informar si la persona sigue la cuenta |
| `window_open` | `true` | Indica si está habilitado el envío de mensajes |
| `clicked:ID_BOTON` | `true` | Indica si hubo un clic en ese botón web dentro del recorrido |
| `email`, `phone` o un campo propio | Un valor guardado | Comparación de texto, existencia o cantidad |

Si pedís que la persona siga la cuenta, decidí qué camino debe tomar `unknown`. La conversión del editor simple deja continuar a `true` y `unknown`, y vuelve a pedir seguimiento sólo cuando recibe `false`. Tocando **Ya te sigo** se comprueba otra vez. Podés modificar esa regla en el borrador.

### Acciones y atención humana

Las acciones disponibles agregan o quitan etiquetas, guardan o vacían campos, incrementan un campo numérico, registran un objetivo y envían una solicitud POST a una integración HTTPS. La integración recibe datos del contacto y del recorrido. Las integraciones y el inicio de otro flujo necesitan una salida de error conectada, que puede informar el problema o finalizar.

**Pausar automatización** y **Derivar a una persona** detienen el recorrido y pausan la automatización del contacto. La nota de derivación queda registrada para el equipo. Los controles del contacto permiten asignar un responsable, guardar notas y volver a habilitar la automatización. También se puede reanudar un recorrido pausado desde el armador; el sistema comprueba la ventana de conversación.

**Iniciar otro flujo** necesita el ID de una campaña con un flujo publicado de la misma cuenta y espacio. Inicia ese recorrido y luego continúa el flujo actual. Si querés terminar el actual después, conectá la acción a **Finalizar**.

## Probar, guardar versiones y revisar actividad

**Probar** abre un simulador interactivo: podés responder mensajes, elegir botones, ingresar datos y avanzar esperas. En los datos de prueba podés cambiar `follows`, campos o el comentario para explorar otras ramas. Las integraciones y el inicio de otros flujos se muestran como acciones simuladas; no realizan solicitudes ni mensajes reales. La simulación no confirma los permisos ni la entrega de Instagram.

**Exportar** guarda el flujo como JSON. **Importar** lo incorpora como borrador. También tenés deshacer, rehacer, duplicación y eliminación de pasos. Importar o elegir una plantilla reemplaza el borrador, y el cambio puede deshacerse antes de guardar.

Cada publicación conserva una versión. Los recorridos iniciados continúan con la versión con la que empezaron. Restaurar una versión reemplaza el borrador; hay que publicarla para activarla. Si otra persona modifica el mismo borrador, el guardado detecta el conflicto; exportá tus cambios antes de recargar.

En **Recorridos** aparecen las ejecuciones recientes, sus estados, pasos y errores. **Actualizar** vuelve a consultar la actividad. Seleccionando un paso podés ver sus conteos de ejecución y los clics de sus botones. Los recorridos pausados se pueden reanudar, y los pendientes se pueden cancelar. Un envío sin confirmar requiere revisar la actividad antes de volver a intentarlo.

**Desactivar flujo visual**, dentro de **Versiones**, vuelve a usar la configuración del editor simple y cancela los recorridos pendientes. Los borradores y las versiones permanecen disponibles.

La demo está en `/demo/flow`: permite probar el editor sin ingresar a una cuenta. Guarda el borrador únicamente en el navegador y requiere una cuenta para publicar o subir archivos.

## Convertir una campaña del editor simple

Al abrir por primera vez el armador, OpenReply prepara un borrador desde la campaña. La conversión conserva:

- El mensaje de apertura habilitado, con la instrucción de responder por texto.
- El mensaje de entrega y los enlaces. Los textos extensos se distribuyen en varios mensajes; los enlaces HTTPS van en botones. Otros destinos se conservan como texto.
- El pedido de seguimiento y el mensaje para volver a verificarlo.
- La pregunta de email, teléfono o texto, antes o después de entregar el recurso, con sus reintentos.
- El agradecimiento por una respuesta válida cuando la pregunta estaba después del recurso.
- El mensaje de seguimiento y su demora. Si hay una pregunta después del recurso, el seguimiento espera a que la pregunta se resuelva.

Las etiquetas de entrada siguen siendo las de la campaña. Los pasos deshabilitados en el editor simple no se agregan al borrador. La captura heredada conserva tres intentos y el vencimiento de un día, o siete días para email/teléfono pedidos antes del recurso. La salida de vencimiento finaliza; la salida de omisión permite continuar sin el dato.

Revisá los textos antes de publicar: la apertura ahora pide una respuesta escrita, los títulos de botón se ajustan a 20 caracteres y un texto heredado de reintento que exceda 1000 bytes conserva el primer fragmento permitido. La conversión genera un borrador; publicar es el paso que cambia la atención de la campaña.

## Archivos y diferencias de proveedor

| Contenido | Formatos de subida | Tamaño máximo | Meta directo | Zernio |
| --- | --- | --- | --- | --- |
| Imagen | JPEG, PNG | 8 MB | Imagen | Imagen |
| Video | MP4, OGG con Theora, AVI, MOV, WebM | 25 MB | Video | Video |
| Audio | AAC, M4A, WAV | 25 MB | Audio | Audio |
| PDF | PDF | 25 MB | Enlace para descargar | Adjunto |

MP3 no está habilitado en esta versión. La interfaz permite subir un archivo o usar una URL HTTPS; Instagram debe poder descargarla sin iniciar sesión. Los archivos subidos necesitan una dirección pública HTTPS de OpenReply y permisos de administrador o propietario. Se guardan en la base de datos por partes; el espacio de archivos tiene un límite de 512 MB por espacio de trabajo.

El primer mensaje del comentario usa texto sin botones con ambos proveedores. Las capacidades del editor no reemplazan los permisos de la cuenta de Instagram: comprobá la entrega con una cuenta real después de instalar.

## Actualizar una instalación

Se necesitan la aplicación web, PostgreSQL, Redis y el worker permanente. El worker actualizado procesa tanto las campañas simples como los flujos; no hace falta iniciar un segundo comando para los flujos.

1. Guardá una copia de seguridad de la base de datos y actualizá el código de la web y el worker a la misma revisión.
2. Instalá las dependencias con `npm ci` y generá el cliente con `npm run db:generate`.
3. Ejecutá `npm run db:migrate` con acceso a PostgreSQL. La migración `20261001120000_flow_builder` agrega borradores, versiones, ejecuciones, clics, archivos y controles de contacto; las campañas existentes comienzan con el flujo visual deshabilitado.
4. Construí la web con `npm run build`, iniciá la aplicación y reiniciá el worker con `npm run worker`.
5. Verificá `/api/health` y comprobá que el worker esté activo. Usa las mismas variables `DATABASE_URL`, `REDIS_URL` y `ENCRYPTION_KEY` que la web. `NEXTAUTH_URL` debe ser la dirección pública HTTPS para subir y entregar archivos.
6. Abrí una campaña, revisá su borrador convertido, probá el recorrido y publicá. Hacé una prueba real de comentario y respuesta escrita, verificando la entrega y el registro por paso.

Las esperas y preguntas pendientes se guardan en PostgreSQL. El worker recupera los recorridos programados cada 30 segundos, incluso después de un reinicio o una interrupción de Redis. Redis debe estar disponible para ejecutar los trabajos. Conservá los servicios programados existentes para renovar credenciales y mantener la integración.

En Dokploy, ejecutá la migración desde un servicio con acceso a la red de la base de datos antes de iniciar la versión nueva. Los detalles de instalación siguen en [despliegue en Dokploy](deploy-dokploy.md) y [configuración de Instagram](setup.md).

## Alcance actual

El alcance implementado es la automatización iniciada por comentarios de Reels y sus conversaciones posteriores. Hay editor visual, mensajes, archivos, preguntas, etiquetas, campos, condiciones, esperas, reparto de caminos, acciones, versiones y registros de ejecución. Tarjetas y galerías, respuestas con IA, carpetas, horarios avanzados y reglas iniciadas por cambios internos siguen pendientes. OpenReply todavía no ofrece equivalencia completa con Manychat.
