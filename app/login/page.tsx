import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { auth, EMAIL_PROVIDER_ID, signIn } from "@/lib/auth";
import { getLoginRedirect, getSignInOptions } from "@/lib/auth-options";
import { getI18n } from "@/lib/i18n/server";
import { getCampaignTemplate } from "@/lib/templates/campaign-templates";
import { DemoNotice } from "@/components/demo-notice";
import { isPublicDemoHost } from "@/lib/env";

const GITHUB_URL = "https://github.com/diwenne/openreply";
const SETUP_DOCS_URL = `${GITHUB_URL}/blob/main/docs/setup.md`;
const DESTINATION_COOKIE = "openreply-login-destination";

async function rememberDestination(callbackUrl: string) {
  const cookieStore = await cookies();
  cookieStore.set(DESTINATION_COOKIE, callbackUrl, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NEXTAUTH_URL?.startsWith("https://") ?? false,
    path: "/",
    maxAge: 60 * 30,
  });
}

function handleSignInError(error: unknown, callbackUrl: string, linkGoogle: boolean) {
  if (!(error instanceof AuthError)) throw error;
  const params = new URLSearchParams({ error: error.type, callbackUrl });
  if (linkGoogle) params.set("linkGoogle", "1");
  redirect(`/login?${params}`);
}

export async function generateMetadata() {
  const { t } = await getI18n();
  return {
    title: t("Login - OpenReply"),
    description: t("Sign in to manage Instagram comment-to-DM campaigns."),
  };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    checkEmail?: string;
    callbackUrl?: string;
    template?: string;
    error?: string;
    linkGoogle?: string;
  }>;
}) {
  const { t } = await getI18n();
  if (await isPublicDemoHost()) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="w-full max-w-md text-center">
          <h1 className="text-2xl font-semibold text-foreground">
            OpenReply
          </h1>
          <div className="panel rounded p-8 mt-8 shadow-black/40">
            <h2 className="text-lg font-semibold text-foreground">
              {t("Sign-in is off on this demo")}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              {t("This is the public demo — it doesn’t create real accounts or send DMs. To use OpenReply for real, clone it and run your own instance with your own Meta app and domain.")}
            </p>
            <a
              href={SETUP_DOCS_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded bg-accent px-6 py-3.5 text-sm font-semibold text-white shadow-indigo-500/25 transition-all hover:shadow-indigo-500/30"
            >
              {t("Clone it yourself")} <span aria-hidden="true">↗</span>
            </a>
          </div>
        </div>
      </div>
    );
  }

  const params = await searchParams;
  const checkEmail = params.checkEmail === "1";
  const selectedTemplate = getCampaignTemplate(params.template);
  const templateCallbackUrl = selectedTemplate
    ? `/campaigns/new?template=${selectedTemplate.slug}`
    : null;
  // Auth.js OAuth errors return only an error code, without the original URL.
  const savedDestination = params.error
    ? (await cookies()).get(DESTINATION_COOKIE)?.value
    : undefined;
  const callbackUrl = getLoginRedirect(params.callbackUrl ?? savedDestination, templateCallbackUrl ?? "/dashboard");
  const options = getSignInOptions();
  const session = await auth();
  const linkingGoogle = Boolean(session?.user && options.google);
  if (session?.user && params.linkGoogle !== "1" && !params.error) {
    redirect(callbackUrl);
  }
  const needsLinking = params.error === "OAuthAccountNotLinked" && !session?.user;

  const errorMessage = !params.error ? null
    : params.error === "OAuthAccountNotLinked"
      ? session?.user
        ? t("This Google account is connected to another account. Choose a different Google account.")
        : options.email
          ? t("You already have an account. Sign in by email once, then connect Google to keep your workspace.")
          : t("You already have an account. Ask your administrator to enable email sign-in so you can connect Google.")
      : params.error === "GoogleEmailNotSupported"
        ? t("Use a Gmail or Google Workspace account, or sign in with email instead.")
      : params.error === "AccessDenied"
        ? t("This account cannot sign in. Use an approved account or contact your administrator.")
        : params.error === "Verification"
          ? t("This sign-in link has expired or was already used. Request a new link below.")
          : t("We could not sign you in. Please try again or contact your administrator.");

  async function continueWithGoogle() {
    "use server";
    await rememberDestination(callbackUrl);
    try {
      await signIn("google", { redirectTo: callbackUrl }, { prompt: "select_account" });
    } catch (error) {
      handleSignInError(error, callbackUrl, linkingGoogle);
    }
  }

  async function sendMagicLink(formData: FormData) {
    "use server";
    await rememberDestination(callbackUrl);
    const destination = needsLinking && options.google
      ? `/login?${new URLSearchParams({ linkGoogle: "1", callbackUrl })}`
      : callbackUrl;
    try {
      await signIn(EMAIL_PROVIDER_ID, {
        email: String(formData.get("email") ?? "").trim(),
        redirectTo: destination,
      });
    } catch (error) {
      handleSignInError(error, callbackUrl, false);
    }
  }

  const emailForm = (
    <form action={sendMagicLink} className="space-y-5">
      <div className="space-y-2">
        <label htmlFor="email" className="block text-sm font-medium text-foreground">
          {t("Work email")}
        </label>
        <input
          id="email" name="email" type="email" required autoComplete="email"
          placeholder="you@company.com"
          className="w-full px-4 py-3 rounded bg-surface border border-border text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none transition-colors"
        />
      </div>
      <button
        type="submit"
        className="w-full inline-flex items-center justify-center gap-2 rounded bg-accent px-6 py-3.5 text-sm font-semibold text-white shadow-indigo-500/25 transition-all hover:shadow-indigo-500/30"
      >
        {t("Email me a magic link")}
      </button>
    </form>
  );

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-foreground">
            OpenReply
          </h1>
          <p className="text-muted text-sm leading-relaxed mt-2">
            {selectedTemplate
              ? t("Sign in to use the {name} template.", { name: selectedTemplate.title })
              : t("Sign in to manage your automations.")}
          </p>
        </div>

        <DemoNotice variant="panel" />

        <div className="panel rounded p-8 shadow-black/40">
          {selectedTemplate && !checkEmail && (
            <div className="mb-5 border border-accent/20 bg-accent/10 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-accent">
                {t("Template selected")}
              </p>
              <p className="mt-2 text-sm font-semibold text-foreground">
                {selectedTemplate.title}
              </p>
            </div>
          )}

          {errorMessage && (
            <p role="alert" className="mb-5 rounded border border-border bg-surface p-4 text-sm text-foreground">
              {errorMessage}
            </p>
          )}

          {checkEmail ? (
            <div className="text-center py-4">
              <h2 className="text-lg font-semibold mb-2">{t("Check your email")}</h2>
              <p className="text-sm text-muted">
                {t("We sent you a secure sign-in link. Open it on this device to continue.")}
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {options.google && (
                <form action={continueWithGoogle} className="space-y-4">
                  {linkingGoogle && (
                    <p className="text-sm text-muted">
                      {t("Connect Google once. Next time, you can sign in without an email link.")}
                    </p>
                  )}
                  <button
                    type="submit"
                    className="w-full inline-flex items-center justify-center gap-2 rounded bg-accent px-6 py-3.5 text-sm font-semibold text-white shadow-indigo-500/25 transition-all hover:shadow-indigo-500/30"
                  >
                    {linkingGoogle ? t("Connect Google") : t("Continue with Google")}
                  </button>
                </form>
              )}
              {options.email && !linkingGoogle && (options.google ? (
                <details open={needsLinking || params.error === "Verification" || params.error === "GoogleEmailNotSupported"}>
                  <summary className="cursor-pointer text-sm text-muted hover:text-foreground">
                    {t("Sign in with email instead")}
                  </summary>
                  <div className="mt-5">{emailForm}</div>
                </details>
              ) : emailForm)}
              {!options.google && !options.email && (
                <p role="status" className="text-sm text-muted">
                  {t("Sign-in is currently unavailable. Contact your workspace administrator.")}
                </p>
              )}
              {session?.user && (
                <a href={callbackUrl} className="block text-center text-sm text-muted hover:text-foreground">
                  {t("Continue to your workspace")}
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
