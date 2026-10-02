# Google sign-in

Users can choose **Continue with Google** instead of requesting an email link. One OAuth application serves the clients using your hosted OpenReply instance; clients do not create their own Google Cloud projects. Their Instagram connection is separate.

## Configure once for your instance

1. Select or create a project in [Google Cloud](https://console.cloud.google.com/). Configure its Google Auth Platform branding and audience. Use an external audience if clients are outside your Google Workspace organization. During testing, add the accounts that will test the login.
2. Create an OAuth client of type **Web application**. Add the exact authorized redirect URI for each environment:
   - Production: `https://YOUR-OPENREPLY-DOMAIN/api/auth/callback/google`
   - Local development on port 3000: `http://localhost:3000/api/auth/callback/google`
   - If using another port, change both the registered URI and `NEXTAUTH_URL` to match.
3. Save the client ID and secret in your hosting environment as `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`. Locally, use an ignored `.env` file. Never commit the secret or put it in a `NEXT_PUBLIC_` variable.
4. Keep `NEXTAUTH_URL` set to this instance's canonical URL and keep the existing `NEXTAUTH_SECRET` and database. Restart or redeploy the web app after changing environment variables.
5. Sign in with an approved test account. Confirm that it reaches the intended workspace, then sign out and sign in again with Google. Complete Google's publishing requirements for your audience before inviting clients.

The provider requests basic identity scopes (`openid`, `profile`, `email`); this login does not request access to Gmail, Drive or Instagram. Both Google credentials must be nonempty or the Google button is hidden. Keep `ALLOWED_EMAILS` populated if the instance is limited to your own users and clients; it applies to both Google and email.

Google login supports Gmail and Google Workspace accounts with verified email. Google accounts using other email providers must use the email fallback, which verifies current mailbox ownership before granting access to email-based workspace invitations. See [Google's email authority rules](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).

Reference: [Auth.js Google provider](https://authjs.dev/getting-started/providers/google) and [Google web application OAuth setup](https://developers.google.com/identity/protocols/oauth2/web-server#creatingcred).

## Existing email accounts

Keep your current `RESEND_API_KEY` or `EMAIL_SERVER` configured during rollout.

1. Choose **Continue with Google** using the address already registered in OpenReply.
2. The login screen explains that the account already exists and opens the email form.
3. Request the email link for that existing account and open it in the same browser.
4. Choose **Connect Google**, then select the Google account you want to use. You remain in the existing account, with its workspaces, campaigns and permissions.
5. Future sign-ins use Google directly. No recurring email link is needed.

An already signed-in user can also visit `/login?linkGoogle=1` to connect Google. They can choose **Continue to your workspace** to skip linking. If a Google account belongs to another OpenReply user, Auth.js rejects the link. There is no automatic merging of users based on matching email addresses.

New Google users get a workspace through the existing account creation flow. To join a client's existing workspace, use that workspace's invitation; matching domains do not grant access. Invitation and campaign-template destinations are retained on successful sign-in.

## Email fallback and rollback

- Email remains available under **Sign in with email instead** when Resend or SMTP is configured. SMTP takes precedence over Resend, as before.
- If Google is unavailable for a client, they can continue using email.
- Before disabling email delivery, confirm that every existing user who needs access has linked Google. Remove both `RESEND_API_KEY` and `EMAIL_SERVER` only if you intentionally want Google-only login.
- To disable Google, remove both Google variables and redeploy, keeping email delivery configured. Existing users and workspaces are not deleted.
- With no configured provider, the page tells users to contact their administrator. It never offers an unauthenticated bypass.

No database schema migration is required: the existing Auth.js Account and Session tables store the Google link and session. Preserve the original MIT license and copyright when distributing this fork.

## Acceptance checks before client rollout

- A new allowed Google user can sign in, sign out, and return to the same workspace.
- An existing email user completes the one-time link and retains their user ID, memberships and campaigns.
- A disallowed address cannot sign in with either method; an unverified Google email is rejected.
- A Google account already linked to another user cannot be attached to the signed-in user.
- Email fallback still delivers a usable link. Cancelled Google login can be retried.
- A client invitation returns to its acceptance page after login. An expired session can return to the login page without a redirect loop.

Automated tests cover configuration, sign-in policies, workspace callbacks and redirect validation. A real Google callback and email delivery still require the instance's credentials and a test database.
