-- =====================================================================
-- Hilal Alsharq AI Agent — 0001 core schema (Phase 1)
-- Customers, conversations, services, orders, specs, payments, staff, tasks
-- Shipping / cartons / credit ledger come in later migrations.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Enums ----------
create type customer_type   as enum ('individual', 'company');
create type staff_role      as enum ('admin', 'sales', 'china_team', 'finance', 'legal', 'support');
create type msg_direction   as enum ('in', 'out');
create type conv_mode       as enum ('bot', 'human');
create type pricing_mode    as enum ('fixed', 'custom', 'percentage');
create type order_status    as enum (
  'draft',            -- collecting data from the customer
  'pending_review',   -- summary shown, waiting for customer approval
  'pending_quote',    -- custom-priced: waiting for staff to set the fee
  'awaiting_payment', -- payment link sent
  'paid',             -- confirmed ONLY by gateway webhook
  'in_progress',
  'completed',
  'cancelled'
);
create type payment_status  as enum ('initiated', 'paid', 'failed', 'refunded');
create type task_status     as enum ('open', 'in_progress', 'done', 'escalated');

-- ---------- Human-readable codes: HA-000125, HA-ORD-000125 ----------
create sequence customer_code_seq start 1;
create sequence order_code_seq    start 1;

create or replace function next_customer_code() returns text language sql as
$$ select 'HA-' || lpad(nextval('customer_code_seq')::text, 6, '0') $$;

create or replace function next_order_code() returns text language sql as
$$ select 'HA-ORD-' || lpad(nextval('order_code_seq')::text, 6, '0') $$;

-- ---------- updated_at helper ----------
create or replace function touch_updated_at() returns trigger language plpgsql as
$$ begin new.updated_at = now(); return new; end $$;

-- =====================================================================
-- Customers
-- =====================================================================
create table customers (
  id               uuid primary key default gen_random_uuid(),
  code             text unique not null default next_customer_code(),
  wa_id            text unique not null,          -- WhatsApp number, verified by WhatsApp itself
  full_name        text,
  alt_phone        text,
  email            text,
  type             customer_type,
  company_name     text,
  cr_number        text,                          -- commercial registration (companies)
  registration_complete boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger customers_touch before update on customers for each row execute function touch_updated_at();

-- Saudi national address (multiple per customer)
create table addresses (
  id               uuid primary key default gen_random_uuid(),
  customer_id      uuid not null references customers(id) on delete cascade,
  label            text,                          -- "المستودع", "البيت"...
  country          text not null default 'SA',
  region           text,
  city             text,
  district         text,
  street           text,
  building_no      text,
  unit_no          text,
  short_address    text,                          -- e.g. RRRD2929
  postal_code      text,
  additional_no    text,
  recipient_name   text,                          -- if different from customer
  recipient_phone  text,
  is_default       boolean not null default false,
  created_at       timestamptz not null default now()
);
create index on addresses(customer_id);

-- =====================================================================
-- Conversations & messages (WhatsApp)
-- =====================================================================
create table conversations (
  id               uuid primary key default gen_random_uuid(),
  customer_id      uuid not null unique references customers(id) on delete cascade,
  mode             conv_mode not null default 'bot',
  assigned_staff   uuid,                          -- FK added after staff table
  state            jsonb not null default '{}'::jsonb,  -- current flow + collected slots
  last_inbound_at  timestamptz,                   -- for the 24h WhatsApp window
  updated_at       timestamptz not null default now()
);
create trigger conversations_touch before update on conversations for each row execute function touch_updated_at();

create table messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references conversations(id) on delete cascade,
  wa_message_id    text unique,                   -- dedupe: WhatsApp retries webhooks
  direction        msg_direction not null,
  type             text not null,                 -- text, interactive, image, document...
  body             text,
  payload          jsonb,                         -- raw message
  sent_by_staff    uuid,
  created_at       timestamptz not null default now()
);
create index on messages(conversation_id, created_at);

-- =====================================================================
-- Service catalog (prices live HERE, never in the prompt)
-- =====================================================================
create table services (
  key              text primary key,              -- 'quote_request', 'factory_1'...
  name_ar          text not null,
  description_ar   text,
  pricing          pricing_mode not null,
  base_price       numeric(12,2),                 -- SAR before VAT (fixed)
  percentage       numeric(5,2),                  -- e.g. 5.00 for integrated sourcing
  vat_applicable   boolean not null default true,
  credit_eligible  boolean not null default false,-- can be deducted from the 5% fee later
  requires_spec_form boolean not null default false,
  menu_group       text not null,                 -- 'sourcing' | 'shipping_compliance' | 'legal'
  sort_order       int not null default 0,
  active           boolean not null default true
);

insert into services (key, name_ar, pricing, base_price, percentage, credit_eligible, requires_spec_form, menu_group, sort_order) values
 ('integrated_sourcing', 'إدارة التوريد المتكاملة',        'percentage', null,  5.00, false, true,  'sourcing', 1),
 ('quote_request',       'طلب تسعيرة منتج',               'fixed',      100,   null, true,  true,  'sourcing', 2),
 ('factory_1',           'نموذج توريد - مصنع واحد',        'fixed',      500,   null, true,  true,  'sourcing', 3),
 ('factory_3',           'نموذج توريد - 3 مصانع ومقارنة',  'fixed',      1000,  null, true,  true,  'sourcing', 4),
 ('production_study',    'دراسة خط إنتاج',                'custom',     null,  null, true,  false, 'sourcing', 5),
 ('inspection_hilal',    'فحص المنتجات - فريق هلال الشرق', 'fixed',      1000,  null, true,  false, 'sourcing', 6),
 ('inspection_3rd',      'فحص المنتجات - طرف ثالث',        'custom',     null,  null, false, false, 'sourcing', 7),
 ('shipping_lcl',        'شحن جزئي LCL / جوي',            'custom',     null,  null, false, false, 'shipping_compliance', 1),
 ('shipping_fcl',        'شحن حاوية كاملة FCL',           'custom',     null,  null, false, false, 'shipping_compliance', 2),
 ('saber',               'شهادات سابر SABER',             'custom',     null,  null, false, false, 'shipping_compliance', 3),
 ('sfda',                'خدمات هيئة الغذاء والدواء SFDA', 'custom',     null,  null, false, false, 'shipping_compliance', 4),
 ('customs',             'التخليص الجمركي',               'custom',     null,  null, false, false, 'shipping_compliance', 5),
 ('legal_consult',       'استشارة قانونية',               'fixed',      400,   null, false, false, 'legal', 1),
 ('legal_contract',      'صياغة العقود والاتفاقيات',       'fixed',      600,   null, false, false, 'legal', 2),
 ('legal_appeal',        'كتابة لائحة استئناف',           'fixed',      1100,  null, false, false, 'legal', 3),
 ('legal_defense',       'إعداد مذكرة دفاع',              'fixed',      600,   null, false, false, 'legal', 4),
 ('legal_najiz',         'رفع دعوى عبر منصة ناجز',        'fixed',      600,   null, false, false, 'legal', 5);

-- =====================================================================
-- Staff
-- =====================================================================
create table staff (
  id               uuid primary key default gen_random_uuid(),
  auth_user_id     uuid unique,                   -- supabase auth.users.id
  full_name        text not null,
  email            text unique,
  wa_id            text,                          -- to notify staff on WhatsApp
  role             staff_role not null,
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);
alter table conversations add constraint conversations_staff_fk foreign key (assigned_staff) references staff(id);

-- =====================================================================
-- Orders
-- =====================================================================
create table orders (
  id               uuid primary key default gen_random_uuid(),
  code             text unique not null default next_order_code(),
  customer_id      uuid not null references customers(id),
  service_key      text not null references services(key),
  status           order_status not null default 'draft',
  base_amount      numeric(12,2),                 -- SAR before VAT
  vat_rate         numeric(5,2) not null default 15.00,
  vat_amount       numeric(12,2),
  total_amount     numeric(12,2),
  customer_approved_at timestamptz,               -- approval of summary before payment
  assigned_staff   uuid references staff(id),
  first_contact_due_at timestamptz,               -- paid_at + 24h
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index on orders(customer_id, created_at desc);
create index on orders(status);
create trigger orders_touch before update on orders for each row execute function touch_updated_at();

-- Product spec form: every edit = new version (requirement: سجل نسخ للتعديلات)
create table spec_versions (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references orders(id) on delete cascade,
  version          int not null,
  data             jsonb not null,                -- validated with zod in the app
  pdf_path         text,                          -- storage path of generated spec PDF
  created_by       text not null default 'bot',   -- 'bot' | 'customer' | staff uuid
  created_at       timestamptz not null default now(),
  unique (order_id, version)
);

create table attachments (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid references orders(id) on delete cascade,
  customer_id      uuid not null references customers(id),
  storage_path     text not null,
  mime_type        text,
  wa_media_id      text,
  caption          text,
  is_legal         boolean not null default false,-- legal docs isolated by RLS
  created_at       timestamptz not null default now()
);
create index on attachments(order_id);

-- Order status history (who / when / what)
create table order_events (
  id               bigserial primary key,
  order_id         uuid not null references orders(id) on delete cascade,
  from_status      order_status,
  to_status        order_status not null,
  actor            text not null,                 -- 'bot' | 'webhook' | staff uuid
  note             text,
  created_at       timestamptz not null default now()
);

-- =====================================================================
-- Payments — paid ONLY via verified gateway webhook, idempotent
-- =====================================================================
create table payments (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references orders(id),
  gateway          text not null,
  gateway_ref      text unique,                   -- prevents double-recording
  amount           numeric(12,2) not null,
  currency         text not null default 'SAR',
  method           text,                          -- mada, applepay, card, tabby, tamara
  status           payment_status not null default 'initiated',
  payment_url      text,
  raw_webhook      jsonb,
  paid_at          timestamptz,
  created_at       timestamptz not null default now()
);
create index on payments(order_id);

-- =====================================================================
-- Staff tasks, handoffs, notifications, audit
-- =====================================================================
create table tasks (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid references orders(id),
  customer_id      uuid references customers(id),
  type             text not null,                 -- 'first_contact', 'custom_quote', 'handoff'
  title            text not null,
  assigned_to      uuid references staff(id),
  status           task_status not null default 'open',
  due_at           timestamptz,
  escalated_at     timestamptz,
  done_at          timestamptz,
  created_at       timestamptz not null default now()
);
create index on tasks(status, due_at);

create table audit_log (
  id               bigserial primary key,
  actor            text not null,
  action           text not null,
  entity           text not null,
  entity_id        text,
  data             jsonb,
  created_at       timestamptz not null default now()
);

-- =====================================================================
-- RLS: everything locked by default. The bot uses the service role.
-- Dashboard policies (per role) come with the admin panel step.
-- =====================================================================
alter table customers      enable row level security;
alter table addresses      enable row level security;
alter table conversations  enable row level security;
alter table messages       enable row level security;
alter table services       enable row level security;
alter table staff          enable row level security;
alter table orders         enable row level security;
alter table spec_versions  enable row level security;
alter table attachments    enable row level security;
alter table order_events   enable row level security;
alter table payments       enable row level security;
alter table tasks          enable row level security;
alter table audit_log      enable row level security;
