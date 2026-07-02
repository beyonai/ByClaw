-- Ensure OpenClaw sandbox shared workspace directories stay writable by both byclaw-be
-- and the sandbox runtime on the shared Longhorn PVC.
--
-- The sandbox container runs as root while byclaw-be runs as appuser(1001).
-- Without an explicit umask/chmod, root-created /by/.sessions or /by/.openclaw
-- children can be 0755 and block backend uploads into sessions, skills, and files.

UPDATE "byai"."sandbox_service_spec"
SET spec_json = jsonb_set(
    spec_json::jsonb,
    '{startup,entrypoint}',
    '[
      "/bin/sh",
      "-c",
      "umask 0000; mkdir -p /by/.sessions /by/.openclaw; chmod a+rwx /by /by/.sessions /by/.openclaw 2>/dev/null || true; chmod -R a+rwX /by/.sessions /by/.openclaw 2>/dev/null || true; exec /usr/local/bin/startAll.sh"
    ]'::jsonb,
    true
  )::text,
  updated_at = CURRENT_TIMESTAMP
WHERE service_key = 'openclaw'
  AND spec_json IS NOT NULL
  AND (
    COALESCE(((spec_json::jsonb) #>> '{startup,entrypoint,0}'), '') <> '/bin/sh'
    OR COALESCE(((spec_json::jsonb) #>> '{startup,entrypoint,2}'), '') NOT LIKE '%chmod -R a+rwX /by/.sessions /by/.openclaw%'
  );
