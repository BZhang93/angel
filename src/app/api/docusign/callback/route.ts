import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";
import { exchangeCode, getIdentity } from "@/lib/docusign/client";
import { currentUser } from "@/lib/session";
import { docusignRedirectUri } from "../connect/route";

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  const jar = await cookies();
  const expectedState = jar.get("docusign_oauth_state")?.value;
  jar.delete("docusign_oauth_state");

  if (!code || !state || state !== expectedState) {
    return NextResponse.redirect(new URL("/settings?error=docusign-state", request.url));
  }

  try {
    const { accessToken, refreshToken } = await exchangeCode(code, docusignRedirectUri(request));
    const identity = await getIdentity(accessToken);

    // Connecting a DIFFERENT account, or the same login in the other
    // environment, means the sync cursor describes a mailbox of envelopes this
    // connection has never seen. Keeping it would silently skip everything
    // older than the moment the previous connection last ran, which is the
    // whole history on a first real connection after a sandbox one.
    const previous = await prisma.docusignAccount.findUnique({
      where: { userId: user.id },
      select: { accountId: true, baseUri: true },
    });
    const switchedAccount =
      previous != null &&
      (previous.accountId !== identity.accountId || previous.baseUri !== identity.baseUri);

    await prisma.docusignAccount.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        accountId: identity.accountId,
        accountName: identity.accountName,
        baseUri: identity.baseUri,
        docusignUserId: identity.userId || null,
        refreshTokenEncrypted: encryptSecret(refreshToken),
      },
      update: {
        accountId: identity.accountId,
        accountName: identity.accountName,
        baseUri: identity.baseUri,
        docusignUserId: identity.userId || null,
        refreshTokenEncrypted: encryptSecret(refreshToken),
        ...(switchedAccount ? { lastSyncedAt: null } : {}),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return NextResponse.redirect(
      new URL(`/settings?error=${encodeURIComponent(message)}`, request.url),
    );
  }

  return NextResponse.redirect(new URL("/settings?docusign=1", request.url));
}
