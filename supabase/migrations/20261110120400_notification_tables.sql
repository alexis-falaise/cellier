-- Cellier migration 05: push subscriptions, forecasts published by clients, running-low state
-- and the notification outbox.

-- One row per Web Push subscription (one per installed device and user).
create table public.push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  endpoint        text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh          text not null check (char_length(p256dh) <= 200),
  auth            text not null check (char_length(auth) <= 100),
  user_agent      text check (user_agent is null or char_length(user_agent) <= 400),
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),   -- refreshed by the client on app start
  last_success_at timestamptz,
  failure_count   integer not null default 0,
  -- Per-device preferences (design 03 §5). A member-level switch also exists on household_members.
  notify_running_low boolean not null default true,
  notify_digest      boolean not null default true
);
create index push_subscriptions_user_id_idx on public.push_subscriptions (user_id);

-- Per-product forecast published by a client after each pull (research/24: the TypeScript model is
-- the reference; the server only reads these values for the daily digest).
create table public.product_forecasts (
  household_id   uuid not null,
  product_id     uuid not null,
  rate_per_day   numeric(10, 4) not null check (rate_per_day >= 0),
  rate_shape     numeric(10, 3) not null check (rate_shape > 0),   -- Gamma shape, for the 80% band
  usual_quantity integer check (usual_quantity is null or usual_quantity >= 0),
  days_left      numeric(8, 2) check (days_left is null or days_left >= 0),   -- null = no estimate
  run_out_at     timestamptz,                                                  -- median run-out date
  confidence     text not null check (confidence in ('low', 'medium', 'high')),
  computed_at    timestamptz not null default now(),
  primary key (household_id, product_id),
  foreign key (household_id, product_id) references public.products (household_id, id) on delete cascade
);

-- Household shopping cadence and predicted next trip, published by a client.
create table public.household_forecasts (
  household_id uuid primary key references public.households (id) on delete cascade,
  cadence_days numeric(6, 2) check (cadence_days is null or cadence_days > 0),
  next_trip_on date,
  confidence   text not null check (confidence in ('low', 'medium', 'high')),
  computed_at  timestamptz not null default now()
);

-- Server-side running-low state per product (hysteresis and notification dedupe).
-- Maintained by triggers; never written by clients.
create table private.low_stock_state (
  household_id   uuid not null,
  product_id     uuid not null,
  is_low         boolean not null default false,
  total_quantity integer not null default 0,
  changed_at     timestamptz not null default now(),
  primary key (household_id, product_id),
  foreign key (household_id, product_id) references public.products (household_id, id) on delete cascade
);
-- Digest query: low products of a household.
create index low_stock_state_low_idx on private.low_stock_state (household_id) where is_low;

-- Notification intents, written in the same transaction as the change that caused them.
-- Delivered by the send-push Edge Function, kicked every minute by pg_cron.
create table private.notification_outbox (
  id           bigint generated always as identity primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  kind         text not null check (kind in ('running_low', 'digest')),
  product_id   uuid,                                   -- running_low only; no FK (row is transient)
  actor_id     uuid,                                   -- member who caused it; excluded from recipients
  dedupe_key   text unique,                            -- digest: 'digest:<household_id>:<yyyy-mm-dd>'
  status       text not null default 'pending'
               check (status in ('pending', 'sending', 'sent', 'skipped', 'failed')),
  not_before   timestamptz not null default now() + interval '20 seconds',   -- debounce window
  attempts     smallint not null default 0,
  claimed_at   timestamptz,
  sent_at      timestamptz,
  last_error   text,
  created_at   timestamptz not null default now()
);
-- Due rows for the sender; FK index on household_id.
create index notification_outbox_due_idx on private.notification_outbox (not_before)
  where status in ('pending', 'sending');
create index notification_outbox_household_id_idx on private.notification_outbox (household_id, created_at);
