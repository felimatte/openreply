# Connect MUSA Content to OpenReply

Deploy the Prisma migrations before serving the integration routes. This integration uses the existing OpenReply database and Instagram connections; it requires no shared application secret or shared login session.

Use **Settings → Client workspaces** to create or select a separate workspace for each client before connecting their Instagram account or inviting their team. Independent workspace creation is available to addresses allowed by `ALLOWED_EMAILS`; an invitation grants access to its workspace, not permission to create an independent one. An unset allowlist preserves open self-hosted signup. The creator becomes OWNER, workspace names must contain 2–80 characters, and creation is limited to ten workspaces per user per hour. Selecting a workspace validates current membership and reloads the dashboard to pin requests to that selection. New Instagram connections use the selected workspace; existing accounts are never moved automatically.

In OpenReply **Settings → MUSA**, a workspace owner or administrator selects the Instagram accounts to share and creates a pairing code. Paste that code into the business's Content settings in MUSA. The code is valid for ten minutes and can be exchanged once. OpenReply keeps a hash of the code and the resulting credential. MUSA must store the returned credential encrypted on its server.

Settings checks publishing readiness for each account. For direct Meta accounts, **Allow video publishing** starts a separate authorization flow that requests the publishing permission. The standard Instagram connection flow continues to request its existing automation permissions. A successful connection alone does not imply publishing is authorized; Meta app review or provider permissions may still be required.

The connection is fixed to the MUSA business, OpenReply workspace, selected account IDs and the granting administrator. Every request checks that the administrator still has owner/admin access and that every granted account remains in the same workspace. Removing an account or the administrator's access stops subsequent calls. Pairing never revokes an earlier grant automatically: MUSA persists its new credential before considering the connection usable and revokes only the newly issued grant if persistence fails. Settings allows an administrator to revoke a connection explicitly.

Use a dedicated workspace for each client. OpenReply members can access every account in their workspace; choosing a subset for MUSA does not restrict those members inside OpenReply. The first exchange permanently binds the workspace to one MUSA business. Another business receives `409 WORKSPACE_ALREADY_BOUND`, including after all grants are revoked. Concurrent codes cannot change that binding. Reconnecting the same business is supported. Existing shared accounts and campaigns are not moved automatically.

## Server API

All routes are under `/api/integrations/musa/v1` and return JSON with `version: 1`, including revocation. Errors use `{version:1,error:{code,message}}` with an appropriate non-success HTTP status. Responses use `Cache-Control: no-store`.

`POST /pair` accepts `{code,businessId,businessName}` and requires `X-Musa-Business-Id` to match `businessId`. Success returns `{version:1,connectionId,workspace:{id,name},accounts:[{id,instagramId,username,provider}],token}`. This is the only response that includes the credential.

Other routes require `Authorization: Bearer <token>` and the same `X-Musa-Business-Id`:

- `GET /accounts` lists only granted accounts with `canPublish`, `publishUnavailableReason` and `supportedFormats`. The format list is `["reel","image","carousel"]` only when the provider confirms publishing authorization; otherwise it is empty. Clients talking to an older server without the list must assume Reel-only when `canPublish` is true.
- `GET /summary?accountId=...&from=...&to=...` returns aggregate automation activity for one granted account. The ISO timestamp range includes `from` and excludes `to`, defaults to the preceding 30 days and is limited to 366 days. Confirmed, failed, skipped and uncertain DM deliveries are counted separately. Contacts are distinct people in the matching automation logs. Clicks include both campaign and flow links. CTR is clicks divided by confirmed sends, capped at 100%. These metrics do not measure Instagram profile reach. A query failure returns an error, rather than fabricated zero activity.
- `GET /campaigns?accountId=...` lists campaigns from that account. A paused campaign without a published post, any-post trigger, DM trigger or existing MUSA publication reservation can be attached. A paused “next reel” draft is supported; the publication process binds the actual confirmed media ID.
- `DELETE /connection` revokes the authenticated connection and returns `{version:1,revoked:true}`.

Publication of Reels, images and mixed carousels is handled by `PUT /publications/:publicationId` and `GET /publications/:publicationId`. MUSA calls PUT when the scheduled time arrives, using its stable publication UUID as the durable idempotency key. It must preserve that UUID and the original payload when polling or retrying. Provider uncertainty must remain visible until reconciled.

## Opening the selected workspace

Navigate to `/integrations/musa/open?workspaceId=...&accountId=...`. OpenReply requires the person's own session and validates both membership and account ownership. A person without access returns to the login screen with the original destination preserved. This route does not create users, impersonate an administrator or issue an authentication session.

When `ALLOWED_EMAILS` restricts independent signup, a workspace owner/admin can still invite a client through **Settings → Team**. A pending invitation must be unexpired and its issuer must still manage that exact workspace. An existing ADMIN/MEMBER membership in someone else's workspace also permits sign-in, including members added directly by an administrator. Accepted or revoked invitations alone grant no admission once membership is removed. The client proves ownership of their own email through the normal magic link. A personal workspace created earlier does not bypass the allowlist, and an unavailable database denies admission outside that list. Invitation-only users cannot create an independent workspace when their invitation or last membership is lost.

The selected workspace is stored as a validated preference. Each dashboard tab pins its requests to the workspace that rendered it using `X-OpenReply-Workspace-Id`, which is checked against current membership on the server. Opening another business in another tab therefore cannot change the first tab's write destination. Browser caches and staged CSV imports are scoped by user and workspace as well.

## Verification

Unit tests cover grant isolation, role loss, account removal, invalid periods, sanitized errors and launch behavior. `__tests__/musa-identity.db.test.ts` also checks atomic one-time consumption, two businesses/workspaces and real aggregation against the explicitly configured disposable local PostgreSQL database. `__tests__/auth-admission.db.test.ts` checks invitation expiry/revocation, issuer role loss, direct membership, personal-workspace restrictions, cross-workspace authority and atomic acceptance. Set `MUSA_TEST_DATABASE_URL` only to the documented local QA instance; the tests refuse other hosts/databases. The tests use synthetic records and never publish Instagram content or send messages.

GitHub CI starts a disposable PostgreSQL 17 service on port 57322, applies all Prisma migrations and sets `MUSA_TEST_DATABASE_URL` for `npm test`, so the MUSA and admission database suites run on every push or pull request to `main`. The separate legacy suites controlled by `TEST_DATABASE_URL` retain their existing opt-in behavior.

## Competitor read authorization

Competitor reads use a separate Facebook user grant, scoped to the MUSA connection and original Instagram account. The consent requests only `instagram_basic`, `instagram_manage_insights`, `pages_read_engagement` and `pages_show_list`. Saving consent still requires verification of the app, effective permissions, finite expiration, original Instagram identity, Facebook identity and linked Page. A saved grant alone does not establish that Business Discovery works; the reader checks that separately.

Meta's [manual login example](https://developers.facebook.com/documentation/facebook-login/guides/advanced/manual-flow) returns a numeric `app_id`. OpenReply accepts either an exact decimal string or a positive safe integer, then compares it with the configured app ID. It does not coerce arbitrary values or relax expiration checks.

Failed callbacks log `musa_discovery_authorization_failed` with a fixed stage, a fixed reason and, for schema failures, only explicitly allowed field names. They never log URLs, OAuth codes, tokens, account identities, exception messages, stacks, causes or response bodies. This distinguishes an exchange failure from a token-format, identity or linked-Page failure without exporting production credentials.
