-- Storage policies for the attachments bucket.
--
-- Objects are stored under a first path segment equal to the owner's user id,
-- so a signed-in user can only ever touch their own folder. This is what makes
-- the session-based upload path safe; the service-role key bypasses these and
-- is only used by the cron, which has no session.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'email files') THEN
    -- Recreate idempotently so re-running the migration is harmless.
    DROP POLICY IF EXISTS "Attachments are readable by their owner" ON storage.objects;
    DROP POLICY IF EXISTS "Attachments are writable by their owner" ON storage.objects;
    DROP POLICY IF EXISTS "Attachments are updatable by their owner" ON storage.objects;
    DROP POLICY IF EXISTS "Attachments are deletable by their owner" ON storage.objects;

    CREATE POLICY "Attachments are readable by their owner" ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'email files' AND (storage.foldername(name))[1] = auth.uid()::text);

    CREATE POLICY "Attachments are writable by their owner" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'email files' AND (storage.foldername(name))[1] = auth.uid()::text);

    CREATE POLICY "Attachments are updatable by their owner" ON storage.objects
      FOR UPDATE TO authenticated
      USING (bucket_id = 'email files' AND (storage.foldername(name))[1] = auth.uid()::text);

    CREATE POLICY "Attachments are deletable by their owner" ON storage.objects
      FOR DELETE TO authenticated
      USING (bucket_id = 'email files' AND (storage.foldername(name))[1] = auth.uid()::text);
  END IF;
END
$$;
