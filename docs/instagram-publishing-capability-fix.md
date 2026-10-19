# Instagram publishing capability repair

Felipe requested the runtime diagnosis and repair for @felimattee on 16 October 2026.
The messaging worker must remain stopped. This task changes only the read-only
publication capability probe and its regression coverage.

## Confirmed runtime failure

The existing production build (main `5f2180090eef3a8ddbe018be2115c983c73cfd4d`)
returned `PERMISSIONS_UNAVAILABLE` after the user renewed Instagram authorization.
A captured server trace for the MUSA accounts GET shows:

- Request: `w5zfg-1792171346115-dc30c6da7b01`.
- Outbound GET: `graph.instagram.com/v25.0/me/permissions`.
- Upstream response: HTTP 400, approximately 242 ms.
- No publication or messaging operation was invoked.

The response body was not inspected; the trace proves the failing endpoint and
HTTP status, not a particular Meta error code or message.

## Repair

For Meta accounts, use the documented read-only
`/{instagramId}/content_publishing_limit?fields=quota_usage,config` endpoint.
Meta documents both `instagram_business_basic` and
`instagram_business_content_publish` as requirements for this endpoint with
Instagram Login on `graph.instagram.com`.

Accept a valid quota response as proof of authorization. An exhausted quota still
means authorized: the publication pipeline already checks publishing capacity.
Keep the existing timeout, account context, encrypted token handling, Zernio path,
and fail-closed behavior for errors and invalid responses. Do not infer permission
from a successful OAuth callback alone or enable publishing on an unknown result.

If logging is necessary, use only fixed diagnostic reasons and numeric upstream
status/error codes. Never include tokens, authorization headers, upstream bodies,
messages, request URLs with query strings, credentials, or stack traces.

## Verification and release

Regression tests must assert the exact account-scoped GET, required fields,
valid and exhausted quota responses, HTTP failures, timeout and malformed/empty
responses. They must reject any publication write from this capability check.
Run the repository checks and inspect GitHub CI on the final PR commit.

Keep this repair on its own branch and PR. Integration and production publication
require Felipe's explicit order after the checks. The live verification after
release must use MUSA's existing connection and confirm `canPublish: true` for
@felimattee while the messaging worker remains without a heartbeat. A real Reel
or DM is not part of this verification.

## Primary references

- [Instagram content publishing limit](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit.md)
- [Instagram User reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user.md)
- [Instagram business login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login.md)
