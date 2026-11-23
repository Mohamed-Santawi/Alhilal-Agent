-- =====================================================================
-- 0006: Client's shipping rules
--   Air  : minimum chargeable 20 kg
--   LCL  : (sea, consolidated) minimum chargeable 1 CBM
--   FCL  : full container — 20ft, 40HQ, reefer — priced per container
-- =====================================================================

-- Minimum chargeable quantity per rate (kg for air, CBM for sea/LCL)
alter table shipping_rates add column if not exists min_qty numeric(12,3) not null default 0;
update shipping_rates set min_qty = 20 where mode = 'air';
update shipping_rates set min_qty = 1  where mode = 'sea';

-- Full-container types
create table fcl_containers (
  key         text primary key,
  name_ar     text not null,
  hint_ar     text,
  sort_order  int not null default 0,
  active      boolean not null default true
);
insert into fcl_containers (key, name_ar, hint_ar, sort_order) values
 ('20ft',   'حاوية 20 قدم',        'حوالي 28 CBM', 1),
 ('40hq',   'حاوية 40 قدم HQ',     'حوالي 68 CBM', 2),
 ('reefer', 'حاوية مبرّدة',        'للمواد الغذائية والمبرّدة', 3);

-- Price per container (versioned like shipping_rates). No current row = "price on request".
create table fcl_rates (
  id              uuid primary key default gen_random_uuid(),
  container_key   text not null references fcl_containers(key),
  price           numeric(12,2) not null,     -- SAR per container, before VAT
  effective_from  timestamptz not null default now(),
  effective_to    timestamptz,
  created_by      text,
  created_at      timestamptz not null default now()
);
create index on fcl_rates(container_key, effective_from desc);
alter table fcl_containers enable row level security;
alter table fcl_rates      enable row level security;

-- SAMPLE prices — replace from the admin panel
insert into fcl_rates (container_key, price, created_by) values
 ('20ft', 9500, 'seed'), ('40hq', 14500, 'seed'), ('reefer', 19000, 'seed');

-- Quotes now have a kind: air | lcl | fcl
alter table shipping_quotes add column if not exists kind text not null default 'lcl'
  check (kind in ('air', 'lcl', 'fcl'));
update shipping_quotes set kind = 'air' where mode = 'air';
alter table shipping_quotes add column if not exists containers jsonb;   -- FCL: [{type, count}]
