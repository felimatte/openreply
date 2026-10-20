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
