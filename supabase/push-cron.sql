-- Optional Web Push schedule. Run AFTER supabase/migrations/20261104_push.sql
-- is applied and the Vault secrets below exist. Fails closed: the block
-- raises before scheduling or changing anything when a secret is missing,
-- and the Edge function itself returns 401/503 without sending when
-- misconfigured. No keys appear here or in CLI arguments — the owner stores
-- them in Vault once (Dashboard → Vault, or their own uncommitted SQL),
-- then runs this.
--
-- Vault secret names:
--   push_project_url       the Supabase project URL (https://....supabase.co)
--   push_scheduler_secret  the server-only PUSH_SCHEDULER_SECRET value
--
-- Requires pg_cron and pg_net (Database → Extensions, or ask support on the
-- Free plan). The job calls the scheduler-only function every 15 minutes;
-- due-send, quiet-hour, cap, and idempotency logic lives server-side, so a
-- missed tick simply sends on the next one — never twice.

do $job$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_project_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_scheduler_secret';
  if v_url is null or v_url = '' then
    raise exception 'push cron not configured: Vault secret push_project_url is missing';
  end if;
  if v_secret is null or v_secret = '' then
    raise exception 'push cron not configured: Vault secret push_scheduler_secret is missing';
  end if;
  -- Secrets are valid at this point, so it is safe to replace the job:
  -- an earlier failure above leaves any working schedule untouched.
  if exists (select 1 from cron.job where jobname = 'witness-push-send-15min') then
    perform cron.unschedule('witness-push-send-15min');
  end if;
  perform cron.schedule(
    'witness-push-send-15min',
    '*/15 * * * *',
    format(
      $schedule$select net.http_post(url := %L || '/functions/v1/witness-push-send', headers := jsonb_build_object('apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'push_scheduler_secret'), 'content-type', 'application/json'), body := '{}'::jsonb, timeout_milliseconds := 30000)$schedule$,
      v_url
    )
  );
end
$job$;
