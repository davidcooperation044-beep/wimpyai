-- Create wai_memory table to store user-scoped remembered facts
create table if not exists public.wai_memory (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.wai_memory enable row level security;
create policy "Users manage their own memory" on public.wai_memory
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
