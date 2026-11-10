# 15. Conflict resolution for a shared pantry inventory

Date of research: 2026-11-10. Scope: Cellier (offline-first iOS PWA, Supabase Postgres backend), several household members editing shared pantries, often offline, with deferred send.

Legend: **UNVERIFIED** marks a claim I could not confirm from a primary source in this session. Everything else is either sourced in the "Sources" section or is design reasoning by the author of this note.

---

## 1. Summary

- Do not sync `quantity` as an absolute value. Two offline withdrawals of 1 from a stock of 7 both send "set quantity = 6"; last-write-wins keeps one of them and loses a unit. The problem is in the intent being recorded, not in the timing.
- Record **intent as deltas** in an append-only `stock_movements` ledger, one row per user action, with a client-generated UUID as the idempotency key. `pantry_stock.quantity` is a derived cache maintained in the same transaction.
- Enforce `quantity >= 0` **on the server**, at apply time, under a row lock. When a withdrawal exceeds stock, clamp, store both the requested and applied amounts, and tell the user.
- Use **field-level LWW with a hybrid logical clock (HLC)** only for descriptive fields (name, category, threshold, price). Use **tombstones** for deletes.
- Make products converge on a **natural key** `(household_id, normalized_name)`. Two devices that create "Pasta" offline get one product; the second device receives a canonical id and an alias mapping.
- Ship one idempotent, transactional RPC `apply_mutations(jsonb)` that claims each mutation id first, applies it in its own savepoint, stores the result, and returns a per-mutation result array.
- Client: IndexedDB outbox, strict per-device order, delete a mutation only on a terminal server result, retry the whole batch on transport failure (safe because of idempotency).
- Prefer `SECURITY INVOKER` for the RPC so RLS policies run on every write. Use `SECURITY DEFINER` only with a pinned `search_path`, a private schema, and explicit `auth.uid()` checks.

---

## 2. Why last-write-wins on an absolute `quantity` loses stock

Scenario, pantry "Basement shelf", pasta on hand = 7 at the server.

| Step | Device A (offline) | Device B (offline) | Server after both sync |
|---|---|---|---|
| 1 | Withdraws 1, local quantity 6, sends `quantity = 6` | Withdraws 2, local quantity 5, sends `quantity = 5` | depends on arrival order |
| 2 | | | LWW keeps 5 (B) or 6 (A). **The true value is 4.** |

Either outcome is wrong by one or two units, and nothing in the data shows it. The write-up of this effect in CRDT literature is that a plain register overwrites concurrent updates instead of combining them ([Shapiro et al., 2011](https://www.cs.tufts.edu/~nr/cs257/archive/marc-shapiro/CRDTs_SSS-2011.pdf)). Automerge's own docs make the same point for numbers: two concurrent increments on a plain value both register the same result, while a Counter type adds them up ([Automerge counters docs](https://automerge.org/docs/reference/documents/counters/)).

Stored as deltas, the same two actions are `-1` and `-2`. They commute, and the result is 4 regardless of order.

**Absolute values are still needed in one place: physical recounts.** A recount ("the shelf has 5") is an assertion about the world. Record it as an `adjust` movement whose delta is computed on the server at apply time: `delta = counted - quantity_at_apply`. The recount then becomes a normal delta, and a concurrent withdrawal is not lost. Show a warning if the recount implies a large unexplained change.

---

## 3. Alternatives compared

| Model | Converges? | Enforces `>= 0`? | Audit trail | Fit for Cellier |
|---|---|---|---|---|
| LWW on absolute `quantity` | Yes (picks a winner) | Only by luck | No | Rejected: loses updates |
| Operation-based deltas, ledger + derived balance | Yes, deltas commute | Yes, server clamps under lock | Full | **Recommended** |
| PN-counter (two G-counters, increments and decrements) | Yes, per-replica maxima merge | **No**: a PN-counter cannot express a floor | Not by itself | Good for convergence, but the floor must still be enforced on the server, so the ledger is needed anyway |
| Bounded counter / escrow (Balegas et al.) | Yes | Yes, with rights transfer between replicas | Partial | Overkill for a household; **UNVERIFIED** (I did not fetch the paper in this session) |
| Server-side rebasing of mutations (Replicache model) | Yes, server is authoritative | Yes, if the mutator checks it | Depends on the mutator | Good model. Replicache's push endpoint re-runs named mutators in mutation-ID order against canonical state ([Replicache, how it works](https://doc.replicache.dev/concepts/how-it-works)). We get the same shape by writing the mutations as SQL in one RPC. |
| CRDT document (Automerge, Yjs) | Yes | No, not for a shared floor | Via history | Overkill; no rich-text merge needed |

**Recommendation: the ledger (operation-based deltas) with a server-enforced floor, plus field LWW for descriptive fields.** PN-counter semantics are what the ledger gives you in aggregate, but the ledger adds the audit trail and the clamp record that the brief needs.

Note on PN-counters: they guarantee convergence of the sum, not the floor. Two replicas that each see 1 unit can each decrement by 1 and both succeed; the merged value is -1. Only a coordinator (the server) can refuse the second one.

---

## 4. Data model

### 4.1 Tables

```sql
-- Households and pantries (shape only; RLS in section 8)
create table public.households (
  id uuid primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  removed_at timestamptz,            -- tombstone for membership, see section 6.4
  primary key (household_id, user_id)
);

create table public.pantries (
  id uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (length(name) between 1 and 200),
  field_clock jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

-- Products are per household: "Pasta" is one product for the whole house.
create table public.products (
  id uuid primary key,               -- client-generated; may be superseded by an alias
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (length(name) between 1 and 200),
  name_key text generated always as (lower(btrim(name))) stored,   -- natural key
  category text,
  threshold int check (threshold is null or threshold >= 0),
  price_cents int check (price_cents is null or price_cents >= 0),
  field_clock jsonb not null default '{}'::jsonb,   -- field -> HLC string of last write
  deleted_at timestamptz,            -- tombstone
  created_at timestamptz not null default now(),
  unique (household_id, name_key)    -- add-vs-add natural key (section 6.5)
);

-- Ids that were merged into a canonical product (add-vs-add).
create table public.product_aliases (
  household_id uuid not null references public.households(id) on delete cascade,
  alias_id uuid not null,
  canonical_id uuid not null references public.products(id) on delete cascade,
  primary key (household_id, alias_id)
);

-- Cache: derived from the ledger by trigger. Never written directly.
create table public.pantry_stock (
  pantry_id uuid not null references public.pantries(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity int not null default 0 check (quantity >= 0),   -- the server-side floor
  updated_at timestamptz not null default now(),
  primary key (pantry_id, product_id)
);

-- Append-only ledger. One row per applied user action.
create table public.stock_movements (
  seq bigint generated always as identity primary key,     -- server order (section 6.9)
  id uuid not null unique,                                 -- = client mutation id
  household_id uuid not null references public.households(id) on delete cascade,
  pantry_id uuid not null references public.pantries(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  kind text not null check (kind in ('in', 'out', 'adjust', 'transfer_out', 'transfer_in')),
  transfer_id uuid,                                        -- links the two legs of a move
  requested_delta int not null check (requested_delta <> 0),
  applied_delta int not null,
  clamped boolean generated always as (applied_delta <> requested_delta) stored,
  actor_id uuid not null references auth.users(id),
  device_id uuid not null,
  client_at timestamptz,                                   -- when the user acted (untrusted)
  created_at timestamptz not null default now(),           -- when the server applied it
  check (applied_delta = 0 or sign(applied_delta) = sign(requested_delta))
);
create index on public.stock_movements (household_id, seq);

-- Idempotency and per-mutation results (section 5).
create table public.mutation_log (
  mutation_id uuid primary key,
  household_id uuid not null,
  actor_id uuid not null,
  device_id uuid not null,
  device_seq bigint not null,
  kind text not null,
  result jsonb,                                            -- null while in flight
  created_at timestamptz not null default now()
);
create index on public.mutation_log (household_id, device_id, device_seq);
```

Notes on the shape:

- `pantry_stock.quantity >= 0` is a database constraint, so a bug in the RPC fails loudly instead of corrupting the balance.
- `stock_movements.applied_delta` is what actually happened; `requested_delta` is what the user asked for. The `clamped` column is generated, so it cannot disagree with the two numbers.
- Products are soft-deleted (`deleted_at`). Movements reference them, so a hard delete would cascade into history. The FK above cascades only on hard deletes and is intentional for the household-deletion case.
- `unique (household_id, name_key)` includes tombstoned rows. Re-creating a deleted product restores the tombstone instead of inserting (section 6.6).

### 4.2 Triggers

The ledger is the only writer of `pantry_stock`. A trigger applies each movement to the cache in the same transaction.

```sql
create function private.apply_movement()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.pantry_stock as s (pantry_id, product_id, quantity, updated_at)
  values (new.pantry_id, new.product_id, new.applied_delta, now())
  on conflict (pantry_id, product_id)
  do update set quantity = s.quantity + excluded.quantity,   -- CHECK (>= 0) still applies
                updated_at = now();
  return new;
end;
$$;

create trigger stock_movements_apply
  after insert on public.stock_movements
  for each row execute function private.apply_movement();

-- Ledger is append-only: no updates or deletes from anyone.
create function private.forbid_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'stock_movements is append-only' using errcode = 'insufficient_privilege';
end; $$;

create trigger stock_movements_no_update
  before update or delete on public.stock_movements
  for each row execute function private.forbid_change();
```

The trigger runs with the privileges of the invoker of the RPC (section 8), which is why it needs no `security definer`. Keep the cache update in the trigger rather than in the RPC, so that any future insert path also keeps the cache correct.

Also consider `after insert` on `mutation_log` to enforce that a result is set once. Optional.

### 4.3 Pantry stock row creation

`pantry_stock` rows are created lazily. The RPC inserts them with `on conflict do nothing` before locking them (section 5.3), so the lock always has a row to hit.

---

## 5. The `apply_mutations` RPC

### 5.1 Contract

Input: `p_household uuid`, `p_device uuid`, `p_batch jsonb` (an ordered array of at most 50 mutations, each with a client-generated UUID `id`, a `device_seq`, a `kind`, and a payload).

Output: a `jsonb` array with one result per input mutation, in the same order. A result never throws for business outcomes; it returns a status. Only infrastructure faults abort the whole call.

Statuses:

| status | meaning | client action |
|---|---|---|
| `applied` | Effect applied now | remove from outbox, apply `canonical_id` remap |
| `duplicate` | Already applied earlier; stored result returned | same as `applied` |
| `clamped` | Applied, but less than requested | remove from outbox, show activity entry |
| `gone` | Referenced product/pantry is deleted | keep in "needs attention", prompt user |
| `forbidden` | Caller is not (or no longer) a member | keep in quarantine, prompt user (section 6.4) |
| `invalid` | Payload fails validation (e.g. negative threshold) | keep in "needs attention", show error |
| `dependency_failed` | Earlier mutation this item depends on was terminal-failed | keep in "needs attention" |
| `retry` | Transient server fault; nothing decided | stop flush, back off, resend the batch |

### 5.2 SQL sketch

Security model: `SECURITY INVOKER` (section 8). RLS policies on every table written here enforce membership.

```sql
create or replace function public.apply_mutations(
  p_household uuid,
  p_device    uuid,
  p_batch     jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  m        jsonb;
  r        jsonb;
  out_arr  jsonb := '[]'::jsonb;
begin
  if jsonb_array_length(p_batch) > 50 then
    raise exception 'batch too large' using errcode = 'program_limit_exceeded';
  end if;

  for m in select value from jsonb_array_elements(p_batch) with ordinality t(value, n) order by n
  loop
    -- Each mutation runs in its own subtransaction: one failure does not roll back the others.
    begin
      r := public.apply_one(p_household, p_device, m);
    exception
      when sqlstate '23514' then   -- check_violation: our invariant caught a bug or a race
        r := jsonb_build_object('id', m->>'id', 'status', 'retry', 'code', sqlstate);
      when sqlstate '40001' or sqlstate '40P01' then  -- serialization / deadlock
        r := jsonb_build_object('id', m->>'id', 'status', 'retry', 'code', sqlstate);
      when others then
        -- Validation and programming errors: terminal for this mutation only.
        r := jsonb_build_object('id', m->>'id', 'status', 'invalid',
                                'code', sqlstate, 'message', sqlerrm);
    end;
    out_arr := out_arr || jsonb_build_array(r);
  end loop;

  return out_arr;
end;
$$;

-- Note: a retry status after a rolled-back subtransaction leaves no partial effect.
```

The per-mutation exception handler is the core of partial-failure handling. Postgres rolls back to the implicit savepoint of the `begin ... exception` block, so a failed mutation leaves no trace, and the batch continues.

Caveat: `sqlerrm` can leak internal detail. Map codes to a fixed message before returning if the RPC is reachable by untrusted callers. The caller is an authenticated household member, so this is low risk, but still worth doing.

### 5.3 `apply_one` (one mutation, idempotent)

```sql
create or replace function public.apply_one(
  p_household uuid,
  p_device    uuid,
  m           jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id      uuid := (m->>'id')::uuid;
  v_kind    text := m->>'kind';
  v_seq     bigint := (m->>'device_seq')::bigint;
  v_uid     uuid := auth.uid();
  v_prev    jsonb;
  v_pid     uuid;
  v_qty     int;
  v_req     int;
  v_applied int;
  v_result  jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- 1. Claim the id. Concurrent duplicates block here until the first transaction
  --    commits, then take the ON CONFLICT branch and read its stored result.
  insert into public.mutation_log (mutation_id, household_id, actor_id, device_id, device_seq, kind)
  values (v_id, p_household, v_uid, p_device, v_seq, v_kind)
  on conflict (mutation_id) do nothing;

  if not found then
    select result into v_prev from public.mutation_log where mutation_id = v_id;
    if v_prev is null then
      -- Another transaction claimed it and has not finished; it will commit or roll back.
      -- Treat as transient.
      return jsonb_build_object('id', v_id, 'status', 'retry', 'code', 'in_flight');
    end if;
    return v_prev || jsonb_build_object('status', 'duplicate');
  end if;

  -- 2. Membership is enforced by RLS on the inserts below (WITH CHECK). A caller who is
  --    not a member gets an RLS violation (42501), which the caller maps to 'forbidden'.
  --    Shown explicitly here for clarity; the policies are the guarantee.
  if not exists (
    select 1 from public.household_members hm
    where hm.household_id = p_household and hm.user_id = v_uid and hm.removed_at is null
  ) then
    v_result := jsonb_build_object('id', v_id, 'status', 'forbidden');
    update public.mutation_log set result = v_result where mutation_id = v_id;
    return v_result;
  end if;

  -- 3. Resolve product aliases (add-vs-add merges, section 6.5).
  v_pid := coalesce(
    (select canonical_id from public.product_aliases
      where household_id = p_household and alias_id = (m->>'product_id')::uuid),
    (m->>'product_id')::uuid
  );

  if v_kind = 'stock.delta' then
    -- Product must exist and be alive (tombstone check, section 6.6).
    perform 1 from public.products
      where id = v_pid and household_id = p_household and deleted_at is null;
    if not found then
      v_result := jsonb_build_object('id', v_id, 'status', 'gone');
      update public.mutation_log set result = v_result where mutation_id = v_id;
      return v_result;
    end if;

    v_req := (m->>'delta')::int;

    -- Ensure the cache row exists, then lock it. The lock serialises concurrent
    -- withdrawals of the same product in the same pantry (section 6.3).
    insert into public.pantry_stock (pantry_id, product_id, quantity)
    values ((m->>'pantry_id')::uuid, v_pid, 0)
    on conflict (pantry_id, product_id) do nothing;

    select quantity into v_qty from public.pantry_stock
      where pantry_id = (m->>'pantry_id')::uuid and product_id = v_pid
      for update;

    -- Clamp at the floor. Positive deltas are never clamped.
    v_applied := case when v_req >= 0 then v_req
                      else greatest(v_req, -v_qty) end;

    insert into public.stock_movements (
      id, household_id, pantry_id, product_id, kind, transfer_id,
      requested_delta, applied_delta, actor_id, device_id, client_at)
    values (
      v_id, p_household, (m->>'pantry_id')::uuid, v_pid,
      case when v_req >= 0 then 'in' else 'out' end,
      nullif(m->>'transfer_id', '')::uuid,
      v_req, v_applied, v_uid, p_device,
      nullif(m->>'client_at', '')::timestamptz);
    -- The trigger updates pantry_stock; its CHECK (quantity >= 0) is the backstop.

    v_result := jsonb_build_object(
      'id', v_id,
      'status', case when v_applied = v_req then 'applied' else 'clamped' end,
      'canonical_product_id', v_pid,
      'requested_delta', v_req,
      'applied_delta', v_applied,
      'quantity_after', v_qty + v_applied);

  elsif v_kind = 'product.update' then
    -- Field LWW by HLC: see section 6.2 (SQL in section 6.2).
    raise exception 'see section 6.2' using errcode = 'feature_not_supported';

  else
    raise exception 'unknown kind %', v_kind using errcode = '22023';
  end if;

  update public.mutation_log set result = v_result where mutation_id = v_id;
  return v_result;
end;
$$;
```

Things to check in review:

- `insert ... on conflict do nothing` on the claim row: the second concurrent transaction waits on the first one's uncommitted row. The read of `result` after `not found` then sees the committed value. **UNVERIFIED** that this waiting behaviour applies exactly as described to `DO NOTHING`; the Postgres `INSERT` page I fetched does not state the locking semantics for `DO NOTHING` ([PostgreSQL INSERT docs](https://www.postgresql.org/docs/current/sql-insert.html)). Test it with two concurrent sessions before relying on it.
- The `in_flight` branch means the claim exists but the result is still null. With the claim and result in one transaction, this is only visible if a transaction is mid-flight, so it is rare.
- The `v_qty + v_applied` for `quantity_after` reads the value before the trigger writes. It is correct because of the row lock.
- The `stock.delta` path does not handle `adjust` (recounts). Add it as a separate kind, computing `delta = counted - quantity` under the same lock (section 6.10).

### 5.4 Ordering inside one device

Within one device, the client sends mutations in `device_seq` order and the RPC processes the array in order. The server does not need to reject gaps; the client never skips a seq. Dependencies (section 6.11) are the only reason to stop early.

---

## 6. Conflict cases

### 6.1 Decision rules

1. Stock is a **sum of deltas**. Never store or accept an absolute stock value from a client, except as a recount that is turned into a delta on the server.
2. Descriptive fields are **LWW per field** using HLC.
3. Existence is a **tombstone**: once deleted, a product does not come back through an update. Only an explicit re-create restores it.
4. The server decides outcomes. The client's optimistic result is a prediction; the server result replaces it.
5. Every clamp, rejection, and merge is **recorded** and surfaced according to its impact.

### 6.2 Field-level LWW with hybrid logical clocks

HLC (Kulkarni et al., 2014) combines a physical clock with a logical counter so that the timestamps respect causality, and the physical part stays close to wall time ([Logical Physical Clocks, OPODIS 2014](https://www.cse.buffalo.edu//~demirbas/publications/hlc.pdf)). The paper is about the clock; using it for field LWW is our design choice.

Encoding: fixed-width string so that lexicographic comparison equals HLC order:

```
hlc = pad15(wall_ms) + "." + pad6(counter) + "." + device_id
```

Client TypeScript sketch:

```ts
// hlc.ts
export type Hlc = string; // fixed-width, lexicographically ordered

export class HybridClock {
  private wall = 0;
  private counter = 0;
  constructor(private deviceId: string, private now = () => Date.now()) {}

  next(): Hlc {
    const t = this.now();
    if (t > this.wall) { this.wall = t; this.counter = 0; }
    else { this.counter += 1; }
    return encode(this.wall, this.counter, this.deviceId);
  }

  // Called when a server time or a remote HLC is observed.
  observe(remote: Hlc): void {
    const { wall, counter } = decode(remote);
    const t = this.now();
    const newWall = Math.max(this.wall, wall, t);
    if (newWall === this.wall && newWall === wall) this.counter = Math.max(this.counter, counter) + 1;
    else if (newWall === wall && newWall !== this.wall) this.counter = counter + 1;
    else if (newWall === this.wall) this.counter += 1;
    else this.counter = 0;
    this.wall = newWall;
  }
}

const pad = (n: number, w: number) => String(n).padStart(w, "0");
const encode = (wall: number, counter: number, dev: string) =>
  `${pad(wall, 15)}.${pad(counter, 6)}.${dev}`;
const decode = (h: Hlc) => {
  const [w, c] = h.split(".");
  return { wall: Number(w), counter: Number(c) };
};
```

The `observe` logic follows the standard HLC receive rule; review it against the paper before use. **UNVERIFIED** as written: I did not check the exact pseudo-code of the paper in this session.

Server rule (SQL, applied per field):

```sql
-- Clamp a client wall-clock that is too far in the future (section 6.8).
-- Then apply the field only if its HLC is newer than the stored one for that field.
update public.products p
set name       = case when (p.field_clock->>'name') is null
                        or (p.field_clock->>'name') < $hlc_name
                      then $name else p.name end,
    field_clock = p.field_clock || jsonb_build_object('name', $hlc_name)
where p.id = $pid
  and ((p.field_clock->>'name') is null or (p.field_clock->>'name') < $hlc_name);
```

In practice one statement per changed field, or a `jsonb` loop over the changed fields. Ties: the device id at the end of the HLC string breaks them deterministically.

Why HLC and not server arrival order: an offline device may send a batch hours late. Arrival order then reflects the sync time, not the edit time. HLC keeps the user's order, and server validation (section 6.8) stops a skewed clock from winning forever.

Why not per-row LWW: two members editing different fields (one renames, one changes the threshold) would lose one edit. Per-field keeps both.

### 6.3 Concurrent withdrawals (the ledger case)

Two devices withdraw from the same pantry-product while offline. Both are `delta = -n` mutations. The RPC locks `pantry_stock` (section 5.3), so the second one sees the first one's effect. No conflict is visible to users unless the floor is hit.

### 6.4 Membership removed while the outbox holds mutations

- Server: `household_members.removed_at` is set. The RLS policies (section 8) stop new writes immediately. Each outbox mutation returns `forbidden`.
- Client: on `forbidden`, the mutation does **not** get dropped silently. A withdrawal may be a real event in someone's kitchen. Move the household's pending mutations into a quarantine list and show a prompt: "N changes from [household] could not be sent because you are no longer a member. Export, or discard?" Export means a CSV of the pending items.
- Local data for a removed household is kept until the user confirms.
- Server history of movements the removed member made stays in the ledger (this is audit data, not personal state). Account deletion is a separate policy question; flagging it as **open**.

### 6.5 Add-vs-add: the same product by two offline devices

Both devices create "Pasta" in the same household with different client UUIDs `p1` (device A) and `p2` (device B), each with its own stock.

Server handling in the `product.upsert` branch:

```sql
-- Insert, or find the existing product with the same normalised name.
insert into public.products (id, household_id, name, category, threshold, field_clock)
values (v_new_id, p_household, $name, $category, $threshold, $clocks)
on conflict (household_id, name_key) do nothing
returning id;

-- If nothing returned, the natural key already exists: merge.
if not found then
  select id into v_canonical from public.products
    where household_id = p_household and name_key = lower(btrim($name));
  if v_canonical <> v_new_id then
    insert into public.product_aliases (household_id, alias_id, canonical_id)
    values (p_household, v_new_id, v_canonical)
    on conflict do nothing;
  end if;
  -- Apply field LWW for the descriptive fields in the incoming payload (section 6.2).
end if;
```

Result to the client: `{status: 'applied', canonical_product_id: v_canonical}`. The client:

1. Rewrites every queued mutation that references `p1` to `p2`'s canonical id (or the canonical returned).
2. Stores `p1 -> canonical` locally, so future reads that show the alias resolve.
3. Stock from both devices is then a sum on the canonical product, through the ledger. Nothing is lost.

Silent merge is correct here. The user sees one "Pasta" row. If the two devices set different thresholds, field LWW decides, and that decision goes to the activity feed (section 7).

Pitfall: the natural key merges by name. "Pasta" and "Pâtes" will not merge. This is intended; a unicode-folding name key can be added later (**UNVERIFIED** whether `lower(btrim())` covers the accented case; it does not).

### 6.6 Delete versus update, and tombstones

- Delete sets `products.deleted_at`. Stock rows and movements stay.
- An update or stock movement for a tombstoned product returns `gone` (section 5.3, `stock.delta` branch). The client shows a prompt: "Pasta was removed by [user]. Restore it, or drop this change?"
- Restore clears `deleted_at` (a `product.restore` mutation). The field clock decides whether the restore is newer than the delete; by default restore wins if it is explicit.
- Re-create with the same name hits the unique key and restores the tombstone instead of creating a new row. Keep the same product id so ledger history stays attached.
- Delete-versus-delete is idempotent: setting `deleted_at` again is a no-op, return `applied`.

Delete with stock on hand: decide with the product. The safe default is "refuse delete if quantity > 0, offer archive". **Open decision.**

### 6.7 Negative stock: two people withdraw the last unit

Stock 1. A withdraws 1 and B withdraws 1, both offline.

- First one applied: `applied_delta = -1`, quantity 0.
- Second one: `v_qty = 0`, `applied_delta = greatest(-1, 0) = 0`, status `clamped`. The ledger row keeps `requested_delta = -1`, `applied_delta = 0`, so the record shows the attempt.
- Client B receives `clamped` and shows an activity entry: "You took 1 Pasta, but the shelf was already empty when your change synced. Recorded as 0." Not a blocking modal, because the physical action already happened.
- Optional: the client can show "Pasta: 0 left" if this was the last unit, which is usually enough.

Negative stock is not allowed in the database. If the household wants a "we owe ourselves" view, it can be shown from `requested_delta - applied_delta` sums. Don't put negative balances in the cache.

### 6.8 Clock skew

- Server ordering (`stock_movements.seq`, `mutation_log` insert order) decides any question about the ledger. Client time is informational (`client_at`).
- For field LWW, the client HLC is used, with a bound: the server clamps any incoming wall time greater than `server_now + 5 min` to `server_now + 5 min` (**UNVERIFIED** threshold; a sensible starting value). Log the clamp.
- A device whose clock runs far behind loses field conflicts to others. Acceptable for descriptive fields. Surface a warning in settings if the device's HLC is ahead of server time by more than the bound, which indicates a clock problem.
- Never use a client timestamp to decide stock. Stock uses order under the lock.

### 6.9 Idempotency and exactly-once effect

- The mutation id is a UUID generated by the client when the user acts, and persisted in the outbox before any network call.
- `mutation_log` claims the id in the same transaction as the effect. A retry of an applied mutation returns the stored result (`duplicate`), with no second ledger row.
- The `stock_movements.id unique` constraint is a second guard.
- Retries after a timeout are therefore safe: the client cannot tell whether the first call committed, and does not need to.
- "Exactly-once effect" here means exactly-once *apply* given at-least-once *delivery*. That is the standard combination; there is no exactly-once delivery on a network. PowerSync's docs say the same: backend operations must be idempotent because the same operation can arrive more than once, and the upload is removed from the queue only after a 2xx response ([PowerSync: handling update conflicts](https://docs.powersync.com/handling-writes/handling-update-conflicts); [PowerSync overview of custom SDKs](https://docs.powersync.com/usage/building-custom-sdks/overview)).

### 6.10 Recounts (absolute assertions)

A recount is `kind = 'adjust'` with payload `counted`. Under the lock:

```sql
v_req := $counted - v_qty;   -- computed on the server, at apply time
-- then insert as a normal movement with requested_delta = v_req, applied_delta = v_req
```

A recount never clamps (it can move the quantity to any non-negative value). A concurrent withdrawal made before the recount is already in the ledger, so the recount is measured against the current value. If the recount was taken before the withdrawal and the user's intent was "the shelf has 5", the result can be off by the withdrawal. Show the recount's "was X at apply time" in the activity feed. **UNVERIFIED** whether households prefer "count at this moment" semantics; open question for product.

### 6.11 Causality and dependent mutations

Example: device A creates product `p1` offline, then withdraws 2 of `p1`. The outbox holds `product.upsert(p1)` before `stock.delta(p1, -2)`.

- If the upsert is applied (or merged into a canonical id), the delta uses the resolved id (section 5.3 step 3).
- If the upsert is terminal-failed (e.g. `invalid`), the client marks every later mutation that references `p1` as `dependency_failed` locally, without sending them. The server never sees them.
- Keep one causal order per device. Do not reorder for performance.

### 6.12 Partial failure of a batch

- Per-mutation savepoints (section 5.2) mean a failing mutation affects only itself. The other results still commit.
- Transport failure (timeout, 5xx, network loss) means the client does not know which mutations committed. Resend the whole batch, in the same order. Idempotency makes this safe.
- Terminal results (`applied`, `duplicate`, `clamped`, `gone`, `forbidden`, `invalid`) are authoritative. Remove the mutation only then.
- `retry` results (serialization, deadlock, in-flight claim) stop the flush and back off with jitter. The next flush resends from the first unfinished mutation.

### 6.13 Moves between pantries

A move is two movements sharing a `transfer_id`:

- `transfer_out` on source pantry, requested `-n`.
- `transfer_in` on destination pantry, applied as the amount actually removed from the source.

Inside `apply_one` for `stock.transfer`: lock both pantry rows in a fixed order (pantry id ascending, to avoid deadlocks), compute `applied = greatest(-n, -source_qty)`, insert the out-leg with `applied`, insert the in-leg with `-applied`. Total stock is conserved, and the ledger shows what really moved.

If the source is short, the destination receives less than requested. Show "Moved 2 of 3 Pasta. Basement had 2." as a clamped activity entry.

Renaming a pantry is a field LWW update on `pantries.name`, like any descriptive field.

### 6.14 Renames

Rename is a `product.update` with `name` and an HLC. Two concurrent renames: the higher HLC wins, the loser is recorded in the activity feed with the old value and an undo action.

Rename versus delete: delete wins (section 6.6). The rename is returned as `gone` and the client prompts.

Rename causing a name-key collision (renaming "Rice" to "Pasta" when "Pasta" exists): the unique key rejects it. Return `invalid` with code `unique_violation` and a message "A product named Pasta already exists. Merge?". This is an explicit prompt case: merging is a user decision.

### 6.15 Descriptive-field conflicts (threshold, price, category)

Field LWW by HLC, silently. Record each overwritten value in an activity entry, so that a silent loss is still visible. Threshold conflicts are rare and low-harm; a per-field merge is not needed.

### 6.16 Table of conflict cases

| # | Case | Server behaviour | Client behaviour | Surfacing |
|---|---|---|---|---|
| 1 | Two offline withdrawals of the same product | Both applied, sum | Clear outbox | Silent |
| 2 | Withdraw of the last unit by two members | First applied, second `clamped` to 0 | Activity entry for the second member | Activity entry, non-blocking |
| 3 | Withdraw more than on hand | Applied up to stock, `clamped` | Activity entry with requested vs applied | Activity entry |
| 4 | Recount versus concurrent withdrawal | Recount applied as delta vs current | Activity entry with value at apply time | Activity entry; warn if large |
| 5 | Add-vs-add, same name, same pantry | Merged to canonical id, alias stored | Remap queued mutations; one row | Silent |
| 6 | Add-vs-add, same name, different pantries | Single product, two stock rows | Same | Silent |
| 7 | Add same name as a tombstoned product | Restores tombstone, keeps id | Row reappears | Activity entry |
| 8 | Rename vs rename | HLC LWW on `name` | Loser's value in activity with undo | Activity entry |
| 9 | Rename vs delete | Delete wins; rename `gone` | Prompt: restore or drop | **Explicit prompt** |
| 10 | Stock movement vs delete | Movement `gone`, not applied | Prompt: restore product or drop change | **Explicit prompt** |
| 11 | Threshold/price vs threshold/price | HLC LWW per field | Activity entry with overwritten value | Activity entry |
| 12 | Delete vs delete | Idempotent `applied` | None | Silent |
| 13 | Move out of A while A is withdrawn | Out-leg clamped, in-leg equals amount moved | Activity entry | Activity entry |
| 14 | Move into a deleted pantry | `gone` | Prompt | **Explicit prompt** |
| 15 | Member removed with queued mutations | `forbidden` (RLS) | Quarantine, prompt: export or discard | **Explicit prompt** |
| 16 | Retry after timeout | `duplicate`, stored result | Remove from outbox | Silent |
| 17 | Batch partial failure (one invalid) | Others applied, one `invalid` | Keep the invalid one, prompt | Prompt for that item only |
| 18 | Transport failure mid-batch | Unknown which committed | Resend same batch | Silent |
| 19 | Dependent mutation after failed create | Not sent | `dependency_failed` locally | Prompt with the parent |
| 20 | Client clock far ahead | Wall clamped to server bound | Warning in settings | Settings warning |
| 21 | Client clock far behind | Loses field LWW | None | None (accepted) |
| 22 | Negative threshold or price in payload | `invalid` (check constraint) | Show error, keep item | Prompt |
| 23 | Two concurrent updates to the same product and same field, same HLC | Device id tie-break | Activity entry | Activity entry |
| 24 | Client decides "withdraw 3 only if on hand >= 3" | Never trusted; server decides | Client shows optimistic result, replaced on sync | Silent unless clamped |

---

## 7. Surfacing conflicts: minimal friction

Three tiers. Default to the lowest that still lets the user notice the outcome.

1. **Silent merge.** Use when the result matches what any reasonable user expects: sums, alias merges, idempotent retries. Cases 1, 5, 6, 12, 16, 18.
2. **Activity entry.** Use when the outcome differs from the request but the user does not need to act. Non-blocking toast on sync plus an entry in a household "Activity" list, with the requested and applied values and an undo where possible. Cases 2, 3, 4, 7, 8, 11, 13, 20 (settings), 23.
3. **Explicit prompt.** Use when the system cannot pick the user's intent: the user must choose. Cases 9, 10, 14, 15, 17 (that item), 19, 22. Keep these few. Batch them into one "Needs attention" list, not one modal per item.

Rule of thumb: never block the kitchen. A withdrawal that was physically done is always recorded; a prompt only asks about what to do with changes the server cannot apply as-is.

Clamped withdrawals are the most common surprise. Phrase them as facts, not errors: "Recorded 0 Pasta. Shelf was empty when your change synced."

---

## 8. Row-level security and the RPC

### 8.1 Facts

- Table owners bypass RLS unless `FORCE ROW LEVEL SECURITY` is set. Superusers and roles with `BYPASSRLS` always bypass it ([PostgreSQL: row security policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)).
- `USING` filters existing rows for reads and for update/delete targets (silently). `WITH CHECK` validates new rows on insert and the new values on update, and raises an error on violation ([PostgreSQL: row security policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)).
- A `SECURITY DEFINER` function runs with the privileges of its owner. Its `search_path` should exclude writable schemas; pin it with `SET search_path = ''` and schema-qualify everything, or pin to a trusted schema and `pg_temp` last ([PostgreSQL: CREATE FUNCTION](https://www.postgresql.org/docs/current/sql-createfunction.html)).
- On Supabase, the `postgres` role has `BYPASSRLS`, so a definer function owned by `postgres` skips policies on the tables it reads. A definer function in an exposed schema is callable through the Data API with the creator's privileges. Keep definer functions in a non-exposed schema, revoke `execute` from `public`, and grant only to `authenticated` ([Supabase: Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security); page fetched 2026-11-10, date on page not shown).

### 8.2 Recommendation: `SECURITY INVOKER` for `apply_mutations`

Why:

- Every write runs as the caller. RLS `WITH CHECK` on `mutation_log`, `stock_movements`, `pantry_stock`, `products`, `product_aliases` enforces membership on each row. Membership is not re-implemented by hand in the function, so a missed check in the function cannot leak writes.
- The trigger `apply_movement` also runs as the caller, which is fine because the caller is allowed to write the cache through the same policy.
- A security definer function would need `search_path` care, a private schema, grant hygiene, and a manual `auth.uid()` membership check on every path. All of that is avoidable.

Policies (sketch):

```sql
alter table public.stock_movements enable row level security;
alter table public.pantry_stock    enable row level security;
alter table public.mutation_log    enable row level security;
alter table public.products        enable row level security;

-- Membership helper in a private schema (not exposed through the API).
create schema if not exists private;
create function private.is_member(h uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.household_members hm
    where hm.household_id = h and hm.user_id = auth.uid() and hm.removed_at is null
  );
$$;
revoke execute on function private.is_member(uuid) from public, anon;
grant execute on function private.is_member(uuid) to authenticated;

-- Ledger: members can read; only inserts pass the policy; never update or delete (trigger too).
create policy movements_read on public.stock_movements for select
  using (private.is_member(household_id));
create policy movements_insert on public.stock_movements for insert
  with check (private.is_member(household_id) and actor_id = auth.uid());
-- no UPDATE/DELETE policy: denied by RLS, and forbidden by trigger.

create policy stock_all on public.pantry_stock for all
  using (exists (select 1 from public.pantries p
                 where p.id = pantry_id and private.is_member(p.household_id)))
  with check (exists (select 1 from public.pantries p
                 where p.id = pantry_id and private.is_member(p.household_id)));

create policy mutation_log_insert on public.mutation_log for insert
  with check (private.is_member(household_id) and actor_id = auth.uid());
create policy mutation_log_read on public.mutation_log for select
  using (private.is_member(household_id));
create policy mutation_log_update on public.mutation_log for update
  using (actor_id = auth.uid()) with check (actor_id = auth.uid());
```

Notes:

- The `private.is_member` helper is `SECURITY DEFINER`, so it can read `household_members` even when the caller's policy would hide it. It is safe only because the `search_path` is pinned, the schema is private, the input is a parameter, and the body uses `auth.uid()`. This is the one place a definer function is justified: it avoids a recursive policy on `household_members`.
- `mutation_log_update` lets the RPC set `result` on its own claim row only. Restrict further if needed.
- The claim-insert uses `ON CONFLICT DO NOTHING`. The `insert` policy must allow it, and the `update` branch is not needed for DO NOTHING. Verify with the actual policy evaluation in a test.
- `products` needs `insert` and `update` policies with the same membership check; `product_aliases` likewise.

### 8.3 Grants

```sql
revoke all on function public.apply_mutations(uuid, uuid, jsonb) from public, anon;
grant execute on function public.apply_mutations(uuid, uuid, jsonb) to authenticated;
revoke all on function public.apply_one(uuid, uuid, jsonb) from public, anon, authenticated;
-- apply_one is called by apply_mutations (same caller); keep it out of the API.
-- If it lives in public, move it to private and grant execute to authenticated only where needed.
```

Also: revoke direct `insert`, `update`, `delete` on `pantry_stock` from `authenticated` if the policies above are not wanted. The RPC is then the only write path. Two layers (grants and RLS) are better than one.

### 8.4 When to choose definer instead

If the team later wants `authenticated` to have no direct table grants at all, a definer RPC is the usual tool. The checklist: private schema or no `anon` grant, `set search_path = ''`, every name schema-qualified, explicit `auth.uid()` membership check on the first line, `revoke execute from public`, and a test that a non-member gets `forbidden` for every mutation kind.

---

## 9. Client implementation sketch

### 9.1 Outbox schema (IndexedDB)

```ts
// outbox.ts
export type MutationKind =
  | "product.upsert" | "product.update" | "product.delete" | "product.restore"
  | "stock.delta" | "stock.transfer" | "stock.adjust";

export interface Mutation {
  id: string;             // UUID, generated when the user acts
  householdId: string;
  deviceSeq: number;      // monotonic per device, persisted
  kind: MutationKind;
  payload: Record<string, unknown>;   // product_id, pantry_id, delta, hlc, ...
  createdAt: number;      // local time, informational
  state: "pending" | "needs_attention" | "quarantined";
  attempts: number;
  lastResult?: ResultStatus;
}

export type ResultStatus =
  | "applied" | "duplicate" | "clamped" | "gone" | "forbidden"
  | "invalid" | "dependency_failed" | "retry";

export interface ResultRow {
  id: string;
  status: ResultStatus;
  canonical_product_id?: string;
  requested_delta?: number;
  applied_delta?: number;
  quantity_after?: number;
  code?: string;
  message?: string;
}
```

Persist the mutation in the same IndexedDB transaction as the optimistic local change. Otherwise a crash between the two loses the intent or leaves an unexplained local change.

### 9.2 Flush loop

```ts
// flush.ts
import type { SupabaseClient } from "@supabase/supabase-js";

const BATCH = 50;

export async function flush(sb: SupabaseClient, outbox: Outbox, house: string, device: string) {
  for (;;) {
    const batch = await outbox.peekPending(house, BATCH);   // ordered by deviceSeq
    if (batch.length === 0) return;

    const wire = batch.map((m) => ({
      id: m.id,
      device_seq: m.deviceSeq,
      kind: m.kind,
      ...m.payload,
    }));

    let rows: ResultRow[];
    try {
      const { data, error } = await sb.rpc("apply_mutations", {
        p_household: house,
        p_device: device,
        p_batch: wire,
      });
      if (error) throw error;          // transport or infrastructure: nothing decided
      rows = data as ResultRow[];
    } catch (e) {
      await backoff(); return;          // resend the same batch later; idempotent
    }

    let stop = false;
    for (const r of rows) {
      const m = batch.find((x) => x.id === r.id)!;
      switch (r.status) {
        case "applied":
        case "duplicate":
          await outbox.remove(m.id);
          if (r.canonical_product_id && r.canonical_product_id !== m.payload.product_id) {
            await outbox.remapProduct(house, String(m.payload.product_id), r.canonical_product_id);
          }
          break;
        case "clamped":
          await outbox.remove(m.id);
          await activity.add({ kind: "clamped", mutation: m, result: r });
          break;
        case "gone":
        case "invalid":
          await outbox.setState(m.id, "needs_attention", r);
          await outbox.dependentsOf(m.id).then((ds) => outbox.markDependencyFailed(ds));
          break;
        case "forbidden":
          await outbox.setState(m.id, "quarantined", r);
          break;
        case "dependency_failed":
          await outbox.setState(m.id, "needs_attention", r);
          break;
        case "retry":
          stop = true;
          break;
      }
      if (stop) break;
    }
    if (stop) { await backoff(); return; }
  }
}
```

Important details:

- `remapProduct` rewrites every pending mutation and every local product reference from the alias to the canonical id, in one IndexedDB transaction. Otherwise later mutations are sent with an id the server resolves through the alias table, which works but is wasteful and error-prone.
- `dependentsOf` walks the causal chain (the outbox references product ids, and product creation is the root).
- The `forbidden` branch changes state and does not remove. Quarantine is a user decision (section 6.4).

### 9.3 Product rename, threshold, price (HLC fields)

The client stamps each field change with `clock.next()` at the moment of the user's action, and sends `hlc` in the payload. The server applies field LWW (section 6.2). The client never sends a whole product row, only the changed fields, so unchanged fields cannot overwrite concurrent edits.

### 9.4 Local display

Display the optimistic state: `quantity = server_cache + sum(pending local deltas)`. When the result arrives, replace the optimistic value with the server's `quantity_after` for that product and pantry, and show pending items as "not yet sent". Never show a negative optimistic quantity; clamp in the UI the same way the server does, so the user's prediction matches.

---

## 10. Recommended design, end to end

1. Client generates a UUID for every user action and writes the mutation to IndexedDB outbox in the same transaction as the optimistic change.
2. Flush sends batches of up to 50, in device order, to `apply_mutations`.
3. Server claims each mutation id (idempotency), checks membership through RLS, resolves aliases, locks the stock row, clamps, writes the ledger, the trigger updates the cache, the result is stored with the claim.
4. Result per mutation: terminal results remove the mutation; `retry` stops the batch; attention states go to a "Needs attention" list.
5. Activity feed shows clamps, overwritten fields, merges, and recount adjustments.
6. Quarantine on membership removal; prompt on delete conflicts.

Operational notes:

- Batch size 50 and a payload size check keep the RPC call well under PostgREST body limits (**UNVERIFIED** exact limit for the current project; check the project's settings).
- Index `mutation_log` by `(household_id, device_id, device_seq)` for debugging.
- Prune `mutation_log` after N days (**UNVERIFIED** retention; a claim must outlive any possible retry window, so pick a window longer than the longest offline period you support).

---

## 11. Alternatives considered and why not

- **Replicache.** Strong match for the model: optimistic mutators, server re-runs mutators in ID order, `lastMutationID` per client, rebase on pull ([Replicache: how it works](https://doc.replicache.dev/concepts/how-it-works)). Costs: a Replicache-specific server, a sync model that owns the local store, and a dependency we do not need, since our server logic is SQL. Reuse its ideas (per-client mutation ids, server authority, rebase) without the library.
- **PowerSync.** Upload queue with `uploadData`, 2xx removes the transaction, server-authoritative with per-field LWW as the default; custom resolution for anything else ([PowerSync: handling update conflicts](https://docs.powersync.com/handling-writes/handling-update-conflicts)). It would replace our outbox. Our RPC design fits its upload contract, so PowerSync remains a valid later option, but the ledger and clamp logic still must be ours.
- **Linear.** Known for an offline-capable sync engine with sync ids (`lastSyncId`). Linear's blog post on scaling the engine (2023-06-29) does not describe write conflicts in the text I could retrieve ([Scaling the Linear Sync Engine](https://linear.app/blog/scaling-the-linear-sync-engine)). The `lastSyncId` mechanism comes from a third-party reverse engineering repo and is **UNVERIFIED** as Linear's documented design. Do not cite it as a source for the conflict model.
- **ElectricSQL.** Read-path sync; writes go through the app's own API. The write-side design here applies unchanged. **UNVERIFIED**: not checked in this session.
- **Automerge.** Counter type adds concurrent increments, and plain values resolve by LWW with conflicts kept ([Automerge counters](https://automerge.org/docs/reference/documents/counters/); [Automerge conflicts](https://automerge.org/docs/reference/documents/conflicts/)). Good model, but it means storing the whole pantry as a document, and it cannot express the floor without a server.

---

## 12. Open questions for the product

1. Recount semantics: "count at this moment" or "count as of when I counted"?
2. Delete with stock on hand: refuse, archive, or allow with a movement that zeroes it?
3. Account deletion of a removed member: keep their ledger rows attributed to them?
4. Should a clamped withdrawal be allowed to create a "we owe" view?
5. Retention window for `mutation_log`.

---

## 13. Sources

- Replicache, "How it works" (fetched 2026-11-10): https://doc.replicache.dev/concepts/how-it-works
- Replicache, "reject mutations" page: returned 404 when fetched 2026-11-10; not used.
- Shapiro, Preguiça, Baquero, Zawirski, "Conflict-free Replicated Data Types", SSS 2011 / INRIA RR-7687 (2011): https://www.cs.tufts.edu/~nr/cs257/archive/marc-shapiro/CRDTs_SSS-2011.pdf. Note: author lists differ between library records; check the PDF before citing authors. The PN-counter section was not retrieved in this session, so its exact merge rules are **UNVERIFIED** here.
- Kulkarni, Demirbas, Madappa, Avva, Leone, "Logical Physical Clocks", OPODIS 2014: https://www.cse.buffalo.edu//~demirbas/publications/hlc.pdf (DOI 10.1007/978-3-319-14472-6_2). Pseudo-code for the HLC receive rule not checked here (**UNVERIFIED**).
- Automerge docs, counters: https://automerge.org/docs/reference/documents/counters/
- Automerge docs, conflicts: https://automerge.org/docs/reference/documents/conflicts/
- PowerSync docs, handling update conflicts (fetched 2026-11-10): https://docs.powersync.com/handling-writes/handling-update-conflicts
- PowerSync docs, custom SDK overview: https://docs.powersync.com/usage/building-custom-sdks/overview (fetch returned 404; the content used came from the search summary of the official docs page, so **UNVERIFIED** as a direct read)
- Linear, "Scaling the Linear Sync Engine", 2023-06-29: https://linear.app/blog/scaling-the-linear-sync-engine (text retrieved did not cover writes or conflicts)
- PostgreSQL 17/current docs, INSERT (ON CONFLICT): https://www.postgresql.org/docs/current/sql-insert.html (locking semantics of DO NOTHING under concurrency **UNVERIFIED**)
- PostgreSQL docs, CREATE FUNCTION (SECURITY DEFINER, search_path): https://www.postgresql.org/docs/current/sql-createfunction.html
- PostgreSQL docs, row security policies: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- Supabase docs, Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security (page date not shown)
- Balegas et al., bounded counters: **UNVERIFIED**, not fetched in this session.
- Not verified in this session: ElectricSQL write model; Linear internal conflict policy.

---

## 14. Test checklist before shipping

- Two concurrent sessions: the same mutation id sent twice returns one ledger row and identical results.
- Two concurrent sessions withdrawing the last unit: exactly one `applied`, one `clamped`, total quantity 0, never negative.
- Replay the outbox after a simulated timeout: no double effect.
- Batch with a failing middle mutation: the first and last commit, the middle returns `invalid`, no partial rows for the middle.
- Member removed mid-outbox: every mutation returns `forbidden`, nothing written.
- Add-vs-add with two different device ids: one product, aliases stored, stock summed, outbox remapped.
- Delete vs stock movement: `gone`, no ledger row, prompt generated.
- Clock set 1 day ahead on one device: HLC wall clamped, warning shown.
- Non-member calling `apply_mutations` directly through the Data API: `forbidden` per mutation, no rows in any table.
