/** Shared by the server configuration and login page; never contains secrets. */
export function getSignInOptions(env: NodeJS.ProcessEnv = process.env) {
  const smtp = Boolean(env.EMAIL_SERVER?.trim());
  return {
    google: Boolean(env.AUTH_GOOGLE_ID?.trim() && env.AUTH_GOOGLE_SECRET?.trim()),
    email: smtp || Boolean(env.RESEND_API_KEY?.trim()),
    emailProviderId: smtp ? ("nodemailer" as const) : ("resend" as const),
  };
}

export function isVerifiedGoogleProfile(
  profile: unknown,
): profile is { email: string; email_verified: true } {
  if (!profile || typeof profile !== "object") return false;
  return (
    "email" in profile &&
    typeof profile.email === "string" &&
    profile.email.trim().length > 0 &&
    "email_verified" in profile &&
    profile.email_verified === true
  );
}

/** Google may only have a historical verification for third-party mailboxes. */
export function isGoogleEmailAuthoritative(profile: unknown): boolean {
  if (!isVerifiedGoogleProfile(profile)) return false;
  return (
    profile.email.trim().toLowerCase().endsWith("@gmail.com") ||
    ("hd" in profile && typeof profile.hd === "string" && profile.hd.trim().length > 0)
  );
}

/** Login destinations must remain inside this instance, including after linking. */
export function getLoginRedirect(value?: string, fallback = "/dashboard"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  if (/[\\\u0000-\u0020\u007f]/.test(value)) return fallback;
  // Browsers normalize dot segments: /a/..//host must not become //host.
  const url = new URL(value, "https://openreply.invalid");
  if (url.pathname.startsWith("//") || url.pathname === "/login" || url.pathname.startsWith("/api/auth")) {
    return fallback;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
