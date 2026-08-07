-- Supabase schema for WimpyAI conversation persistence
-- Run this manually in Supabase SQL editor or via migration tooling.

-- Enable the pgcrypto extension if not already available.
-- This provides gen_random_uuid() for UUID defaults.
create extension if not exists pgcrypto;

-- Conversation metadata and ownership
create table if not exists public.wai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb default '{}'::jsonb
);

create index if not exists idx_wai_conversations_user_id on public.wai_conversations(user_id);
create index if not exists idx_wai_conversations_updated_at on public.wai_conversations(updated_at desc);

-- Message records within a conversation
create table if not exists public.wai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.wai_conversations(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('assistant', 'user', 'system')),
  content text not null default '',
  images jsonb default '[]'::jsonb,
  created_at timestamptz not null default now(),
  metadata jsonb default '{}'::jsonb
);

create index if not exists idx_wai_messages_conversation_id on public.wai_messages(conversation_id);
create index if not exists idx_wai_messages_user_id on public.wai_messages(user_id);
create index if not exists idx_wai_messages_created_at on public.wai_messages(created_at desc);

-- Keep conversation updated_at in sync on message insert/update/delete or conversation update
create function public.wai_refresh_conversation_updated_at() returns trigger as $$
begin
  update public.wai_conversations
  set updated_at = now()
  where id = new.conversation_id;
  return new;
end;
$$ language plpgsql;

create trigger wai_messages_refresh_conversation_updated_at
  after insert or update on public.wai_messages
  for each row execute function public.wai_refresh_conversation_updated_at();

create function public.wai_conversation_updated_at_trigger() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger wai_conversations_updated_at
  before update on public.wai_conversations
  for each row execute function public.wai_conversation_updated_at_trigger();

-- Row-level security policies for ownership enforcement
alter table public.wai_conversations enable row level security;
alter table public.wai_messages enable row level security;

create policy "Conversations are visible to owner" on public.wai_conversations
  for select using (auth.uid() = user_id);

create policy "Conversations are insertable by owner" on public.wai_conversations
  for insert with check (auth.uid() = user_id);

create policy "Conversations are updatable by owner" on public.wai_conversations
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Conversations are deletable by owner" on public.wai_conversations
  for delete using (auth.uid() = user_id);

create policy "Messages are visible to conversation owner" on public.wai_messages
  for select using (
    exists (
      select 1
      from public.wai_conversations c
      where c.id = conversation_id
        and c.user_id = auth.uid()
    )
  );

create policy "Messages are insertable by conversation owner" on public.wai_messages
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.wai_conversations c
      where c.id = conversation_id
        and c.user_id = auth.uid()
    )
  );

create policy "Messages are updatable by conversation owner" on public.wai_messages
  for update using (
    auth.uid() = user_id
    and exists (
      select 1 from public.wai_conversations c
      where c.id = conversation_id
        and c.user_id = auth.uid()
    )
  ) with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.wai_conversations c
      where c.id = conversation_id
        and c.user_id = auth.uid()
    )
  );

create policy "Messages are deletable by conversation owner" on public.wai_messages
  for delete using (
    auth.uid() = user_id
    and exists (
      select 1 from public.wai_conversations c
      where c.id = conversation_id
        and c.user_id = auth.uid()
    )
  );

-- Optional helper view to fetch conversations with their latest message and counts
create view public.wai_conversation_summaries as
select
  c.id,
  c.user_id,
  c.title,
  c.created_at,
  c.updated_at,
  count(m.*) as message_count,
  max(m.created_at) as last_message_at
from public.wai_conversations c
left join public.wai_messages m on m.conversation_id = c.id
group by c.id, c.user_id, c.title, c.created_at, c.updated_at;
