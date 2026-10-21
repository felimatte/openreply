# Confirmación de Reels publicados desde MUSA

- Fecha: 2026-10-20. Estado: en curso.
- Escritor exclusivo: Codex, agente diagnostico_recibo_openreply.
- Repositorio: https://github.com/felimatte/openreply
- Checkout: C:/Users/felip/Ecosistemas/Proyectos/Openreply-confirmacion-reels-musa
- Rama: codex/confirmacion-reels-musa
- Base: origin/main, ddc8246f452c3c3497c44a105b857ff131a493e8
- Integrador: agente raíz MUSA; integración y publicación requieren orden de Felipe.
- Objetivo: recuperar confirmación exacta de Meta tras perder la respuesta de media_publish, usando solo GET del contenedor persistido. Nunca volver a publicar.
- Alcance: recibos MUSA de OpenReply, proveedor Meta, evidencia persistida, reserva de campañas y pruebas.
- Contrato coordinado con MUSA: confirmation opcional con source=meta_container, containerId y status=PUBLISHED. Solo para published sin mediaId ni permalink.
- Límites: no mensajes, worker, cuenta real, video de prueba ni base de producción. Sin secretos ni .env real.
- Instrucciones leídas: AGENTS.md y CLAUDE.md de OpenReply; TRABAJO_EN_PARALELO.md y CLAUDE.md de MUSA como contrato de coordinación.
- Validación prevista: unitarios y TypeScript; CI con Postgres desechable y restricciones DB. Ningún servidor de publicación se inicia localmente.
- Puertos: ninguno para aplicación/worker. Datos: fixtures y Postgres aislado de CI.
- Dependencia: MUSA implementa contrato, persistencia y proyección visual en su propia rama.

## Entrega para revisión

- Código: fdbe87ddf8710d2deedce1b6f8e1f9eed41e3056.
- El GET de recibos reconcilia únicamente un contenedor Meta persistido, con ID exacto, lease compartida y cooldown de 60 segundos. No crea ni publica contenido, ni busca coincidencias por texto/fecha.
- Una respuesta PUBLISHED del contenedor puede confirmar publicación sin media ID ni enlace. Se persiste confirmationContainerId y se devuelve confirmation con source=meta_container y status=PUBLISHED solo en ese caso.
- SQL exige prueba Meta exacta, no nula y compatible con estado/campos. Campañas sin media ID siguen pausadas y reservadas por la API y el trigger DB; no se asocia otro Reel.
- Los recibos con media ID conocido pueden finalizar aunque falle el enlace opcional. Un error de respuesta DB posterior al commit no degrada una publicación confirmada.
- El deadline del proveedor ahora cubre también leer el cuerpo; se conserva el límite de 3500 ms. El POST no se repite.
- Instrucción Next adicional leída: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md.

Validación leída después de concluir:
- GitHub CI 39469532853, código fdbe87d: success. Migración en PostgreSQL 17 descartable, TypeScript, lint, 903 pruebas pasadas y 40 omitidas; build correcto.
- Publicaciones: 42 tests de estado, 41 de proveedor y 9 de DB correctos en CI.
- Local: 83 pruebas específicas y 878 de la suite completa pasadas; 65 DB omitidas sin entorno local. TypeScript y lint correctos tras completar npm ci.
- La primera ejecución local de TypeScript se lanzó con npm ci aún instalando y falló por tipos Next incompletos; se repitió después de finalizar instalación y pasó.
- Preview Vercel de la rama no tiene DATABASE_URL y falla antes de aplicar migraciones. No se añadieron secretos ni se cambió el despliegue; la validación DB procede de GitHub con credenciales ficticias.
- Fuente del protocolo: https://www.postman.com/meta/instagram/request/munmruq/get-ig-container-status

Estado: listo para revisión. PR https://github.com/felimatte/openreply/pull/3, sin integrar ni publicar.
Próximo paso del integrador: verificar CI del último commit de documentación, coordinar MUSA compatible primero y solicitar orden explícita de Felipe antes de integración/publicación. No se probó contra una cuenta real, no se envió ningún Reel y no se inició el motor de mensajes.
