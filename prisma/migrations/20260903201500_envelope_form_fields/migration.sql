-- Values typed into a DocuSign envelope's fields. Authoritative in a way
-- extracted text is not: nobody had to read them off a rendered page.
ALTER TABLE "Document" ADD COLUMN "formFields" JSONB;
