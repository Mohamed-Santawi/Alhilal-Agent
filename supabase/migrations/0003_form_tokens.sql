-- 0003: one-time, expiring links to web forms (registration now; spec form / packing list later)
create table form_tokens (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references customers(id) on delete cascade,
  purpose      text not null,                 -- 'register' | 'spec' | 'packing_list' ...
  token_hash   text not null unique,          -- sha256 of the token; the raw token is never stored
  expires_at   timestamptz not null,
  used_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index on form_tokens(customer_id, purpose);
alter table form_tokens enable row level security;
