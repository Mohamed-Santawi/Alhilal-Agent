-- =====================================================================
-- 0005: Shipping price calculator (quote first, register later)
-- Everything price-related is DATA the client edits — nothing hard-coded.
-- =====================================================================

create type shipping_mode   as enum ('sea', 'air');
create type surcharge_kind  as enum ('percent', 'fixed');
create type quote_status    as enum ('estimate', 'accepted', 'expired');

-- Global settings (single row)
create table shipping_settings (
  id                       int primary key default 1 check (id = 1),
  vat_rate                 numeric(5,2) not null default 15.00,
  quote_validity_days      int not null default 7,
  air_volumetric_divisor   int not null default 6000,   -- kg = L×W×H(cm) / divisor
  prices_are_samples       boolean not null default true, -- shows a "sample prices" banner until the client enters real prices
  updated_at               timestamptz not null default now()
);
insert into shipping_settings (id) values (1);

-- Product categories (clothes, electrical tools, accessories...)
create table shipping_categories (
  key         text primary key,
  name_ar     text not null,
  hint_ar     text,
  sort_order  int not null default 0,
  active      boolean not null default true
);

-- Prices per category × mode. Changing a price = close the old row (effective_to) and add a new one.
create table shipping_rates (
  id              uuid primary key default gen_random_uuid(),
  category_key    text not null references shipping_categories(key),
  mode            shipping_mode not null,
  unit_price      numeric(12,2) not null,      -- SAR per CBM (sea) or per kg (air), before VAT
  min_charge      numeric(12,2) not null default 0,
  effective_from  timestamptz not null default now(),
  effective_to    timestamptz,
  created_by      text,
  created_at      timestamptz not null default now()
);
create index on shipping_rates(category_key, mode, effective_from desc);

-- Temporary extra fees: war risk, peak season... (mode null = both)
create table shipping_surcharges (
  id          uuid primary key default gen_random_uuid(),
  name_ar     text not null,
  mode        shipping_mode,
  kind        surcharge_kind not null,
  amount      numeric(12,2) not null,           -- percent (15 = 15%) or fixed SAR
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Every calculated quote is saved (with the exact prices used) — also for sales follow-up on visitors
create sequence quote_code_seq start 1;
create or replace function next_quote_code() returns text language sql as
$$ select 'HA-Q-' || lpad(nextval('quote_code_seq')::text, 6, '0') $$;

create table shipping_quotes (
  id            uuid primary key default gen_random_uuid(),
  code          text unique not null default next_quote_code(),
  customer_id   uuid not null references customers(id) on delete cascade,
  category_key  text not null references shipping_categories(key),
  mode          shipping_mode not null,
  cartons       jsonb not null,            -- [{qty, l, w, h, kg}]
  photo_path    text,
  cbm           numeric(12,3) not null,
  actual_kg     numeric(12,2) not null,
  chargeable    numeric(12,3) not null,    -- CBM (sea) or kg (air)
  breakdown     jsonb not null,            -- rate, surcharges, amounts — snapshot at quote time
  subtotal      numeric(12,2) not null,
  vat_amount    numeric(12,2) not null,
  total         numeric(12,2) not null,
  valid_until   timestamptz not null,
  status        quote_status not null default 'estimate',
  accepted_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index on shipping_quotes(customer_id, created_at desc);

alter table shipping_settings   enable row level security;
alter table shipping_categories enable row level security;
alter table shipping_rates      enable row level security;
alter table shipping_surcharges enable row level security;
alter table shipping_quotes     enable row level security;

-- Private bucket for product photos sent with quotes
insert into storage.buckets (id, name, public) values ('quote-photos', 'quote-photos', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- SAMPLE DATA — replace with the client's real categories and prices.
-- While prices_are_samples = true the calculator shows a "sample prices" banner.
-- ---------------------------------------------------------------------
insert into shipping_categories (key, name_ar, hint_ar, sort_order) values
 ('clothes',     'ملابس وأقمشة',        'ملابس، أحذية، شنط، مفروشات', 1),
 ('electrical',  'أدوات كهربائية',      'أجهزة، إضاءة، أسلاك، أدوات', 2),
 ('accessories', 'إكسسوارات',           'إكسسوارات، هدايا، مستلزمات', 3),
 ('general',     'بضائع عامة',          'أي منتجات أخرى', 4);

insert into shipping_rates (category_key, mode, unit_price, min_charge, created_by) values
 ('clothes',     'sea', 750, 300, 'seed'), ('clothes',     'air', 28, 300, 'seed'),
 ('electrical',  'sea', 900, 400, 'seed'), ('electrical',  'air', 35, 400, 'seed'),
 ('accessories', 'sea', 800, 300, 'seed'), ('accessories', 'air', 30, 300, 'seed'),
 ('general',     'sea', 850, 300, 'seed'), ('general',     'air', 32, 300, 'seed');
