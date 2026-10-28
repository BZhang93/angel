import "server-only";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { attachmentPath, uploadAttachment } from "@/lib/storage";
import { guessDocumentKind } from "@/lib/gmail/parse";
import { matchCompanyByContent } from "@/lib/gmail/content-match";
import type { DocumentKind } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import {
  accessTokenFromRefresh,
  downloadEnvelopePdf,
  getEnvelopeFormData,
  listCompletedEnvelopes,
  type DocusignEnvelope,
} from "./client";

// Pulling signed envelopes straight from DocuSign.
//
// Worth doing even though completion emails often carry the PDF: whether an
// envelope's documents are attached to that email is an account setting, the
// email can be deleted, and the envelope is the authoritative copy either way.
// Terms are read by the same extractor used for email attachments, so the
// gap-fill rules and provenance are identical.

export interface DocusignSyncResult {
  envelopes: number;
  stored: number;
  matched: number;
  failed: number;
  /// True when the connected account lives in DocuSign's developer sandbox.
  /// An empty sandbox and an empty real account look identical in the result,
  /// and the sandbox is the overwhelmingly likelier reason to find nothing.
  sandbox: boolean;
  /// The account the envelopes were counted in, so a pull that finds nothing
  /// can say where it looked.
  accountName: string;
  searchedFrom: Date;
}

/// Envelope subjects are usually "Please DocuSign: Acme SAFE.pdf". The company
/// is found from the subject and the signer names, using the same
/// one-company-only rule as email matching.
function evidenceText(envelope: DocusignEnvelope): string {
  const signers = envelope.recipients?.signers ?? [];
  return [
    envelope.emailSubject,
    ...signers.map((signer) => [signer.name, signer.email].filter(Boolean).join(" ")),
  ]
    .filter(Boolean)
    .join("\n");
}

export async function syncDocusign(
  userId: string,
  opts: { sinceDays?: number; limit?: number } = {},
): Promise<DocusignSyncResult> {
  const account = await prisma.docusignAccount.findUnique({ where: { userId } });
  if (!account) throw new Error("Connect DocuSign first.");

  const accessToken = await accessTokenFromRefresh(decryptSecret(account.refreshTokenEncrypted));
  const identity = {
    baseUri: account.baseUri,
    accountId: account.accountId,
    userId: account.docusignUserId,
  };

  // Re-reading from a little before the last sync is cheap insurance:
  // envelopes complete out of order, and a missed one is invisible. The
  // comment used to say this while the code started exactly at lastSyncedAt,
  // which bought no insurance at all; the overlap is now real. Re-reading an
  // envelope costs nothing, since storage keys on the envelope id.
  const OVERLAP_DAYS = 7;
  const fromDate = account.lastSyncedAt
    ? new Date(account.lastSyncedAt.getTime() - OVERLAP_DAYS * 24 * 60 * 60 * 1000)
    : new Date(Date.now() - (opts.sinceDays ?? 1095) * 24 * 60 * 60 * 1000);

  const envelopes = await listCompletedEnvelopes(accessToken, identity, { fromDate });
  const companies = await prisma.company.findMany({
    where: { userId },
    select: { id: true, name: true },
  });
  const named = companies.map((company) => ({ companyId: company.id, name: company.name }));

  let stored = 0;
  let matched = 0;
  let failed = 0;

  for (const envelope of envelopes.slice(0, opts.limit ?? 100)) {
    const existing = await prisma.document.findUnique({
      where: { userId_docusignEnvelopeId: { userId, docusignEnvelopeId: envelope.envelopeId } },
    });
    if (existing?.storagePath) continue;

    const match = matchCompanyByContent(evidenceText(envelope), named, {
      subject: envelope.emailSubject,
    });
    const companyId = match && match.confidence >= 0.8 ? match.companyId : null;
    if (companyId) matched += 1;

    try {
      const pdf = await downloadEnvelopePdf(accessToken, identity, envelope.envelopeId);
      // Typed field values, where the envelope had any. A missing form_data
      // response is not a failure: plenty of envelopes are flat documents.
      const fields = await getEnvelopeFormData(accessToken, identity, envelope.envelopeId).catch(
        () => [],
      );
      // Prisma's Json input needs a plain serialisable value, not a typed array.
      const formFields: Prisma.InputJsonValue | undefined =
        fields.length > 0 ? (fields as unknown as Prisma.InputJsonValue) : undefined;
      const path = attachmentPath(
        userId,
        `docusign-${envelope.envelopeId}`,
        envelope.envelopeId,
        `${envelope.emailSubject || "envelope"}.pdf`,
      );
      await uploadAttachment(path, pdf, "application/pdf");

      await prisma.document.upsert({
        where: { userId_docusignEnvelopeId: { userId, docusignEnvelopeId: envelope.envelopeId } },
        create: {
          userId,
          companyId,
          docusignEnvelopeId: envelope.envelopeId,
          kind: guessDocumentKind(envelope.emailSubject) as DocumentKind,
          title: envelope.emailSubject || `Envelope ${envelope.envelopeId}`,
          mimeType: "application/pdf",
          sizeBytes: pdf.byteLength,
          storagePath: path,
          formFields,
        },
        update: {
          storagePath: path,
          sizeBytes: pdf.byteLength,
          companyId,
          formFields,
        },
      });
      stored += 1;
    } catch {
      // An envelope whose documents cannot be downloaded (restricted, or purged
      // by a retention policy) is skipped; the next sync retries it.
      failed += 1;
    }
  }

  await prisma.docusignAccount.update({
    where: { userId },
    data: { lastSyncedAt: new Date() },
  });

  return {
    envelopes: envelopes.length,
    stored,
    matched,
    failed,
    sandbox: account.baseUri.includes("demo.docusign.net"),
    accountName: account.accountName ?? "connected",
    searchedFrom: fromDate,
  };
}
