---
name: depurar-con-evidencia
description: Investigar y corregir un fallo reproducible siguiendo su causa entre interfaz, API y datos, con verificación proporcional y continuidad del proyecto.
license: MIT
---

# Depurar con evidencia

Versión propia del orquestador, 18/10/2026. La [procedencia](PROCEDENCIA.md) conserva la referencia técnica; esta versión es autocontenida y no depende de Superpowers, TDD u otras skills.

Usar ante un fallo concreto. Antes de proponer un arreglo, identificar la copia operativa, el contrato local, el comportamiento esperado y una forma acotada de reproducirlo. Las reglas de negocio, marca, componentes protegidos y stack del proyecto determinan qué cambios son válidos.

## Acotar la causa

Separar hechos observados de hipótesis. Elegir la siguiente observación por su capacidad de distinguir causas: entrada recibida, estado anterior, llamada, respuesta, transformación o escritura. En aplicaciones seguir el mismo caso entre interfaz, endpoint y persistencia; una respuesta exitosa no prueba que se guardó el dato correcto. En scrapers e importaciones comprobar también el significado del resultado y el cruce de origen/destino, no sólo que el proceso termina.

Comparar con un caso que sí funciona y revisar cambios cercanos al fallo. Formular una hipótesis y modificar lo mínimo para comprobarla. Si el resultado la contradice, actualizar la explicación antes de acumular parches. Una dificultad técnica no crea una aprobación nueva ni autoriza cambiar la arquitectura o las reglas del producto.

## Herramientas y entorno

Consultar documentación actual de la versión usada cuando el fallo dependa de una API; usar Context7 si está disponible. Comprobar las herramientas reales de la sesión. En PowerShell usar rutas y sintaxis propias del sistema; no copiar comandos Bash, extractores de credenciales o arranques de servicios de una referencia genérica. Reutilizar el entorno de prueba y los puertos del proyecto. No duplicar bots, consumidores o servicios conectados para reproducir un fallo.

## Verificar y cerrar

Repetir el caso original con el arreglo y comprobar un caso cercano que pueda haberse afectado. Elegir tests, tipos, navegador, lectura de salidas o comprobación manual según el cambio y las convenciones locales. Para una corrección de interfaz revisar el resultado visible y su mensaje; compilar no comprueba su sentido. No imponer tests nuevos a correcciones documentales o visuales triviales.

Registrar causa, cambio, evidencia y lo que quedó sin verificar en la continuidad propia de esa tarea. Distinguir revisión estática, prueba de fixture y flujo real. Un ejemplo, mock o ensayo no acredita un resultado de producción; conservar el aprendizaje en el alcance que lo produjo.
