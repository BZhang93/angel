import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { authorizeUrl, docusignConfigured } from "@/lib/docusign/client";
import { currentUser } from "@/lib/session";

export function docusignRedirectUri(request: Request): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const origin =
    process.env.NODE_ENV !== "development" && forwardedHost
      ? `https://${forwardedHost}`
      : new URL(request.url).origin;
  return `${origin}/api/docusign/callback`;
}

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  if (!docusignConfigured()) {
    return NextResponse.redirect(new URL("/settings?error=docusign-not-configured", request.url));
  }

  const state = randomBytes(16).toString("hex");
  const jar = await cookies();
  jar.set("docusign_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });

  return NextResponse.redirect(authorizeUrl(docusignRedirectUri(request), state));
}
