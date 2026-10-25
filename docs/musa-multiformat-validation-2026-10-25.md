# MUSA multiformat verification — 2026-10-25

Implementation branch: `codex/openreply-multiformato-20261025`, based on
`9c77b05e0692f88113ccdebefbbc4213debf8b90`. This is the OpenReply companion
to MUSA's approved calendar extension for Reels, images and mixed carousels.

## Observed checks

- Full Vitest suite: 932 passed, 67 skipped; the skipped suites require a PostgreSQL server.
- TypeScript, full ESLint, Prisma schema validation and `git diff --check`: passed.
- `scripts/qa-musa-multiformat-pglite.mjs`: all 29 versioned migration files applied
  unchanged on disposable PostgreSQL 17.5 WASM; 26 SQL assertions passed.
- Independent review checked legacy payload/hash compatibility, parent-only
  confirmation and public URL validation. Trailing-dot local hostnames now have
  dedicated rejection regressions without changing the original URL string.

SQL checks cover legacy receipts created before the new migration, ordered child
progress, parent/child exclusion, exact Meta proof, campaign reservations and
lease compare-and-set predicates. Provider tests cover restart/readiness,
rate limits, lost responses, images, mixed carousels and exact confirmation.

## Limits and release order

No real account, provider call, publication, worker or production database was used.
PGlite runs a single serialized connection: it verifies PostgreSQL constraints and
SQL predicates, not Prisma transport or races between independent server sessions.
The existing PostgreSQL CI suites remain required. Next.js production build was
not run locally; TypeScript and the complete available unit suite were run.

Apply the additive OpenReply migration and deploy the compatible processor before
MUSA enables the new formats. Preserve the compatible processor and schema while
any carousel is processing or uncertain. Merge, production deployment and the
first real publication require their own explicit release instruction.
