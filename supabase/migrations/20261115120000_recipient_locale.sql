-- Cellier migration: notifications in each recipient's language.
--
-- The interface language is per user. The app saves it in the account's user metadata
-- (`cellier_locale`: 'fr' | 'en' | 'sv'; prefixed because Google's own `locale` claim is merged into
-- the same object at sign-in). `recipients_for` now returns it with each recipient, and the
-- send-push Edge Function writes the notification in it (French when null or unknown).
--
-- Only the return value gains a key: an older send-push ignores it, a newer send-push treats its
-- absence as French, so the migration and the function can be deployed in either order.
create or replace function private.recipients_for(p_household uuid, p_kind text, p_exclude uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
           jsonb_agg(jsonb_build_object(
             'userId', m.user_id,
             'locale', (select u.raw_user_meta_data ->> 'cellier_locale' from auth.users u where u.id = m.user_id),
             'subscriptions', subs.list)),
           '[]'::jsonb)
  from public.household_members m
  cross join lateral (
    select jsonb_agg(jsonb_build_object('id', ps.id, 'endpoint', ps.endpoint, 'p256dh', ps.p256dh, 'auth', ps.auth)) as list
    from public.push_subscriptions ps
    where ps.user_id = m.user_id
      -- per-device preference (design 03 §5)
      and case p_kind when 'running_low' then ps.notify_running_low else ps.notify_digest end
  ) subs
  where m.household_id = p_household
    and subs.list is not null
    and (p_exclude is null or m.user_id <> p_exclude)
    and case p_kind when 'running_low' then m.notify_running_low else m.notify_digest end;
$$;
