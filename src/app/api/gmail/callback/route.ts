import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";
import { exchangeCode, getProfile } from "@/lib/gmail/client";
import { currentUser } from "@/lib/session";
import { redirectUriFor } from "../connect/route";

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  const jar = await cookies();
  const expectedState = jar.get("gmail_oauth_state")?.value;
  jar.delete("gmail_oauth_state");

  if (!code || !state || state !== expectedState) {
    return NextResponse.redirect(new URL("/settings?error=oauth-state", request.url));
  }

  try {
    const { accessToken, refreshToken } = await exchangeCode(code, redirectUriFor(request));
    const profile = await getProfile(accessToken);

    await prisma.gmailAccount.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        emailAddress: profile.emailAddress,
        refreshTokenEncrypted: encryptSecret(refreshToken),
      },
      update: {
        emailAddress: profile.emailAddress,
        refreshTokenEncrypted: encryptSecret(refreshToken),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return NextResponse.redirect(
      new URL(`/settings?error=${encodeURIComponent(message)}`, request.url),
    );
  }

  return NextResponse.redirect(new URL("/settings?connected=1", request.url));
}
