import { mentionsCompany, type NamedCompany } from "./content-match";

// Which company an attachment belongs to, when the email it arrived on already
// has one.
//
// An attachment inherits the email's company, which is right nearly always and
// wrong in the one case that matters: a syndicate manager who attaches another
// deal's paperwork to this deal's mail. That happened. A subscription agreement
// for a different SPV, signed by someone else, was filed under the company the
// email was about, linked to that company's position, and became the document
// of record behind its investment claim.
//
// So a filename that names a different portfolio company is treated as a
// contradiction rather than as nothing. The document is still stored, just
// unfiled, which puts it in front of a human instead of into a position.

/// Filenames separate words with underscores, dots and dashes as readily as
/// spaces, and whole-word matching needs real boundaries to see the name.
export function filenameText(filename: string): string {
  return filename.replace(/[._+\-]+/g, " ");
}

/// The company to file an attachment under: the email's company unless the
/// filename names a different one, in which case none, pending review.
export function companyForAttachment(
  filename: string,
  emailCompanyId: string | null,
  companies: NamedCompany[],
): string | null {
  if (!emailCompanyId) return null;

  const text = filenameText(filename);
  const named = companies.filter((company) => mentionsCompany(text, company.name));
  // Names nobody, or names the email's own company: nothing contradicts the
  // email, so it inherits as before. A filename naming two companies includes
  // this one, and a cover sheet mentioning both is not evidence of misfiling.
  if (named.length === 0) return emailCompanyId;
  if (named.some((company) => company.companyId === emailCompanyId)) return emailCompanyId;
  return null;
}
