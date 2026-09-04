-- Documents can now come from a link in an email (an investment memo, a call
-- recording page with its transcript, or the company's own site) as well as
-- from an attachment.
ALTER TYPE "DocumentKind" ADD VALUE 'MEMO';
ALTER TYPE "DocumentKind" ADD VALUE 'RECORDING';
ALTER TYPE "DocumentKind" ADD VALUE 'WEBSITE';
