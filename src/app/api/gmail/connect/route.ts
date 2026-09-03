import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { authorizeUrl, googleOAuthConfigured } from "@/lib/gmail/client";
import { currentUser } from "@/lib/session";

export function redirectUriFor(request: Request): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const origin =
    process.env.NODE_ENV !== "development" && forwardedHost
      ? `https://${forwardedHost}`
      : new URL(request.url).origin;
  return `${origin}/api/gmail/callback`;
}

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  if (!googleOAuthConfigured()) {
    return NextResponse.redirect(new URL("/settings?error=google-not-configured", request.url));
  }

  // CSRF state, held in an httpOnly cookie and checked on the way back.
  const state = randomBytes(16).toString("hex");
  const jar = await cookies();
  jar.set("gmail_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });

  return NextResponse.redirect(authorizeUrl(redirectUriFor(request), state));
}
