-- =====================================================================
-- 0009: Orders — order number, stages the customer follows, WhatsApp update per stage
--   • Shipping orders: created when the customer accepts a quote (air/LCL) or a container offer (FCL)
--   • Service orders: created by staff from the chat (SABER, inspection, legal…)
--   • Stages are editable by the admin (name, customer message, notify on/off)
-- =====================================================================

create table if not exists order_stages (
  key         text primary key,
  track       text not null check (track in ('shipping', 'service')),
  name_ar     text not null,
  message_ar  text,                         -- sent to the customer when the order enters this stage
  notify      boolean not null default true,
  sort_order  int not null,
  active      boolean not null default true
);
alter table order_stages enable row level security;

insert into order_stages (key, track, name_ar, message_ar, sort_order) values
 ('awaiting_payment', 'shipping', 'بانتظار الدفع',                   'تم تأكيد طلبك، وهو الآن بانتظار الدفع. سيتواصل معك فريقنا بتفاصيل الدفع.', 1),
 ('awaiting_goods',   'shipping', 'بانتظار وصول البضاعة للمستودع',  'تم تأكيد الدفع ✅ طلبك الآن بانتظار وصول البضاعة إلى مستودعنا في الصين.', 2),
 ('received',         'shipping', 'تم الاستلام في المستودع',        '📦 استلمنا بضاعتك في مستودعنا في الصين، وجارٍ تجهيزها للشحن.', 3),
 ('shipped',          'shipping', 'تم الشحن من الصين',              '🚢 تم شحن بضاعتك من الصين.', 4),
 ('arrived_sa',       'shipping', 'وصلت السعودية',                  'وصلت شحنتك إلى السعودية.', 5),
 ('customs',          'shipping', 'في التخليص',                     'شحنتك الآن في مرحلة التخليص الجمركي.', 6),
 ('out_for_delivery', 'shipping', 'خرجت للتوصيل',                   '🚚 خرجت شحنتك للتوصيل إلى عنوانك.', 7),
 ('delivered',        'shipping', 'تم التسليم',                     '✅ تم تسليم شحنتك. شكراً لثقتك بهلال الشرق 🌙', 8),
 ('svc_awaiting_payment', 'service', 'بانتظار الدفع', 'تم تأكيد طلبك، وهو الآن بانتظار الدفع. سيتواصل معك فريقنا بتفاصيل الدفع.', 1),
 ('svc_in_progress',      'service', 'قيد التنفيذ',   'تم تأكيد الدفع ✅ بدأ فريقنا العمل على طلبك.', 2),
 ('svc_completed',        'service', 'مكتمل',         '✅ تم إنجاز طلبك. شكراً لثقتك بهلال الشرق 🌙', 3)
on conflict (key) do nothing;

alter table orders
  add column if not exists quote_id         uuid references shipping_quotes(id),
  add column if not exists track            text not null default 'service' check (track in ('shipping', 'service')),
  add column if not exists stage            text references order_stages(key),
  add column if not exists stage_at         timestamptz,
  add column if not exists title            text,          -- short description shown to the customer
  add column if not exists cancelled_reason text;
create unique index if not exists orders_quote_uidx on orders(quote_id) where quote_id is not null;
create index if not exists orders_stage_idx on orders(stage);

alter table order_events alter column to_status drop not null;
alter table order_events
  add column if not exists from_stage text,
  add column if not exists to_stage   text,
  add column if not exists notified   boolean;

-- Container (FCL) price offer sent by staff
alter table shipping_quotes
  add column if not exists offer_note  text,
  add column if not exists offered_at  timestamptz,
  add column if not exists offered_by  uuid references staff(id);
