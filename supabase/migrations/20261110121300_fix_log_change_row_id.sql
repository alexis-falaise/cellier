-- Cellier migration 14: fix private.log_change for tables that lack some of the columns named in
-- its row-id CASE. PL/pgSQL resolves every field of a record referenced in one expression against
-- the row type, including branches not taken, so the CASE failed on every table without
-- pantry_id (error: record "v_row" has no field "pantry_id"), which blocked create_household.
-- The fields are now read through jsonb, which tolerates absent keys. Same output format
-- (uuid text form). Triggers are unchanged.

create or replace function private.log_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row       record;
  v_json      jsonb;
  v_household uuid;
  v_entity    text := tg_argv[0];
  v_row_id    text;
  v_sync_id   bigint;
begin
  if tg_op = 'DELETE' then v_row := old; else v_row := new; end if;

  if tg_op = 'UPDATE' and to_jsonb(new) = to_jsonb(old) then
    return null;   -- no-op update
  end if;

  v_json := to_jsonb(v_row);
  if v_entity = 'household' then
    v_household := (v_json ->> 'id')::uuid;
  else
    v_household := (v_json ->> 'household_id')::uuid;
  end if;

  -- During a household delete the cascaded child deletes need no log: the household is gone.
  if tg_op = 'DELETE' and not exists (select 1 from public.households h where h.id = v_household) then
    return null;
  end if;

  v_row_id := case v_entity
    when 'stock'  then (v_json ->> 'pantry_id') || ':' || (v_json ->> 'product_id')
    when 'member' then v_json ->> 'user_id'
    else v_json ->> 'id'
  end;

  insert into private.household_sync as s (household_id, last_sync_id)
  values (v_household, 1)
  on conflict (household_id) do update set last_sync_id = s.last_sync_id + 1
  returning s.last_sync_id into v_sync_id;

  insert into private.change_log (household_id, sync_id, entity, row_id, op)
  values (v_household, v_sync_id, v_entity, v_row_id,
          case when tg_op = 'DELETE' then 'delete' else 'upsert' end);

  perform private.nudge_household(v_household, v_sync_id);
  return null;
end;
$$;

revoke all on function private.log_change() from public, anon, authenticated;
