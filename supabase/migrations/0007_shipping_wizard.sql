-- =====================================================================
-- 0007: Shipping wizard v2 (client answers, Nov 2026)
--   • Air / LCL: door to door, several products per shipment, mandatory product photos
--   • Mixed shipment priced at the highest category (setting: highest | per_item)
--   • Remote cities: per-carton local delivery fee; admin keeps the list of "main" cities
--   • FCL (20 / 40HQ / reefer): NO price — a request (port, city, factory address, services) for the team
--   • Transit times + customs notice are admin-editable texts
-- =====================================================================

alter table shipping_settings
  add column if not exists mixed_pricing text not null default 'highest'
    check (mixed_pricing in ('highest', 'per_item')),
  add column if not exists remote_fee_per_carton numeric(12,2),            -- null = not set yet → team confirms
  add column if not exists transit_air_ar text not null default 'حوالي 10 أيام من استلام البضاعة في مستودعنا',
  add column if not exists transit_sea_ar text not null default 'حوالي 60 يوماً في الغالب من استلام البضاعة في مستودعنا',
  add column if not exists customs_notice_ar text not null default 'قد تتأخر بعض الشحنات في حالات قليلة بسبب إجراءات التفتيش الجمركي وأخذ العينات.';

-- Main cities (no remote fee). Any city not in this list = remote area.
-- Empty list = remote check is off (every city treated as main).
create table if not exists shipping_cities (
  id          uuid primary key default gen_random_uuid(),
  name_ar     text not null unique,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);
alter table shipping_cities enable row level security;

-- FCL request = a quote row without a price
alter type quote_status add value if not exists 'requested';

alter table shipping_quotes alter column category_key drop not null;   -- several products now live in items
alter table shipping_quotes alter column subtotal     drop not null;
alter table shipping_quotes alter column vat_amount   drop not null;
alter table shipping_quotes alter column total        drop not null;

alter table shipping_quotes
  add column if not exists items            jsonb,    -- [{category_key, category_ar, product, cartons:[...], photos:[paths]}]
  add column if not exists city             text,     -- delivery city in Saudi Arabia
  add column if not exists is_remote        boolean not null default false,
  add column if not exists dest_port        text,     -- FCL: dammam | riyadh | jeddah
  add column if not exists factory_address  text,     -- FCL: loading place in China
  add column if not exists services         jsonb,    -- FCL: ["customs", "certificates", "full"]
  add column if not exists notes            text;

-- Container prices are no longer used (FCL is priced by the team per request)
update fcl_rates set effective_to = now() where effective_to is null;
