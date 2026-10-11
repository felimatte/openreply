# Publishing from MUSA

MUSA calls `PUT /api/integrations/musa/v1/publications/{uuid}` only when an approved video is due. Authenticate with the paired MUSA token and business header. Each call performs at most one provider operation (3.5-second network timeout) and returns the durable receipt. Repeat the same PUT after `retryAfterSeconds` while `status` is `processing`. GET only reads a receipt and never starts or advances publication.

The UUID is globally unique and permanently records its payload hash. Changing the account, caption, media URL, cover or campaign under an existing UUID returns 409. Reconnecting MUSA cannot make the same UUID publish again. Processing has a persistent 30-second lease; the application does not rely on in-memory locks or a request staying alive while Instagram transcodes a video.

## Providers

- Meta: the account must have granted `instagram_business_basic` and `instagram_business_content_publish`. Standard Instagram connection/reconnection keeps the existing automation scopes; it does not request publishing. Workspace owners/admins explicitly choose **Allow video publishing** for a Meta account in the MUSA settings, using `purpose=publish` with the workspace and local account ID. The signed OAuth state binds that account, and the callback rejects a different Instagram identity. Enable the permission in the Meta app before this opt-in; external customer accounts require the applicable Advanced Access/App Review. Returning from OAuth does not prove the scope was granted: the capability check reads the real permissions. The steps are create container, poll readiness, read actual account quota, publish, then record the confirmed media ID. Containers are created when due, not when planning the calendar.
- Zernio: the account health response must confirm `permissions.canPost` and a valid token. A post is scheduled about 30 seconds after dispatch so Zernio handles the video asynchronously. `publishNow` is synchronous and is deliberately not used. The same UUID and original timestamp are reused with `Idempotency-Key` after uncertain creation, only within 23 hours of the first attempt (the documented window is 24 hours). Thereafter the receipt becomes uncertain.

Video and optional cover must be direct public HTTPS media URLs, downloadable by the provider. MUSA/OpenReply do not generate a video or copy files from a sharing webpage. The file must satisfy the selected provider's format, duration and size restrictions. No actual publication is performed by the test suite.

## Confirmation and campaigns

`published` requires a confirmed Instagram media ID. An interrupted or timed-out Meta publish operation becomes `uncertain`; repeated PUTs return that state without repeating the publish call. Check the Instagram account and reconcile manually before initiating a new publication UUID. Never turn an uncertain result into an automatic retry under a new UUID.

An optional campaign must be paused, belong to this workspace/account, have no assigned post, and not target every post or DMs. A paused “next Reel” draft can be selected. Its target and activation are locked by a database trigger while publication is processing or uncertain, preventing the next-Reel worker from winning a race. After confirmation the exact media ID is assigned, next-Reel flags are cleared, and the campaign stays paused. Campaign activation remains a separate human action.

If the campaign changed or disappeared, a confirmed video remains `published` with `CAMPAIGN_BINDING_CONFLICT`. This reports the failed association without resending the already published video. Permalink lookup failure likewise does not invalidate a confirmed media ID.

A definite failure releases the campaign reservation (the requested campaign remains in the immutable payload). An uncertain result keeps the reservation. Losing access to an already submitted Zernio post is uncertain, since revoking a credential does not cancel the remote post.

Apply both MUSA migrations before enabling these endpoints. The publication ledger is retained when grants are revoked. The API rechecks the grant, granting administrator and account scope on every call.

## Verification

`npm test` covers the state machine and provider boundaries using mocked HTTP. To exercise real PostgreSQL leases, unique reservations and campaign guards, point `MUSA_TEST_DATABASE_URL` at the dedicated local database `postgresql://postgres:postgres@127.0.0.1:57322/openreply_musa_qa`, apply migrations, and run `npx vitest run __tests__/musa-publications.db.test.ts`. The test rejects any other host, port or database, creates its own fixtures, forbids external fetches, and removes only those fixtures.

Official contracts: [Meta publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing/), [Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login/), [Meta App Review](https://developers.facebook.com/docs/instagram-platform/app-review/), [Zernio idempotency](https://docs.zernio.com/guides/idempotency), [Zernio create post](https://docs.zernio.com/posts/create-post), [Zernio account health](https://docs.zernio.com/accounts/get-account-health).
