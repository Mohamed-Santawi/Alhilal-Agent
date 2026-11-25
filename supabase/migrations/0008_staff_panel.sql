-- =====================================================================
-- 0008: Staff panel — inbox, tasks follow-up, staff notifications
-- =====================================================================

-- When staff last opened the chat (unread = inbound messages after this)
alter table conversations add column if not exists staff_seen_at timestamptz;

-- Tasks: link to the quote/request, staff note, who closed it
alter table tasks
  add column if not exists quote_id uuid references shipping_quotes(id) on delete set null,
  add column if not exists note     text,
  add column if not exists done_by  uuid references staff(id);
create index if not exists tasks_customer_idx on tasks(customer_id, status);

-- Staff: get a WhatsApp alert for every new task
alter table staff add column if not exists notify boolean not null default false;

-- Inbox list: one row per conversation with its last message, unread and open-task counts.
-- security_invoker → RLS of the base tables applies (no anon access); service role reads it from the server.
create or replace view staff_inbox with (security_invoker = true) as
select
  c.id, c.customer_id, c.mode, c.state, c.last_inbound_at, c.staff_seen_at, c.assigned_staff,
  cu.code, cu.full_name, cu.wa_id, cu.company_name, cu.registration_complete,
  lm.body  as last_body, lm.direction as last_direction, lm.type as last_type, lm.created_at as last_at,
  (select count(*) from messages m
     where m.conversation_id = c.id and m.direction = 'in'
       and m.created_at > coalesce(c.staff_seen_at, '-infinity'::timestamptz))::int as unread,
  (select count(*) from tasks t
     where t.customer_id = c.customer_id and t.status in ('open', 'in_progress'))::int as open_tasks
from conversations c
join customers cu on cu.id = c.customer_id
left join lateral (
  select body, direction, type, created_at from messages m
  where m.conversation_id = c.id order by created_at desc limit 1
) lm on true;

revoke all on staff_inbox from anon, authenticated;
