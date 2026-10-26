-- NABH Readiness Guide: run this once in Supabase → SQL Editor → New query → Run.

-- 1) Tables -------------------------------------------------------------
create table if not exists public.scores (
  code        text primary key,               -- e.g. AAC.2.b
  s           smallint check (s between 0 and 5), -- 1-5 score, 0 = not applicable, null = cleared
  a           text default '',                -- action plan / remark
  updated_by  text,
  updated_at  timestamptz default now()
);
create table if not exists public.drafts (
  pid         text primary key,               -- policy id, e.g. p002
  html        text default '',
  status      text default '',                -- draft | review | approved
  notes       text default '',
  updated_by  text,
  updated_at  timestamptz default now()
);
create table if not exists public.settings (
  id          text primary key,
  data        jsonb not null default '{}',
  updated_by  text,
  updated_at  timestamptz default now()
);
-- Optional allow-list. Leave empty to let ANY signed-in email edit.
-- To restrict:  insert into public.allowed_domains values ('even.in');
create table if not exists public.allowed_domains ( domain text primary key );

-- Every change is recorded here (who, when, before, after).
create table if not exists public.audit_log (
  id          bigserial primary key,
  tbl         text,
  key         text,
  changed_by  text,
  changed_at  timestamptz default now(),
  old         jsonb,
  new         jsonb
);

-- 2) Who may read/write -----------------------------------------------------
create or replace function public.is_allowed() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.role() = 'authenticated'
     and ( not exists (select 1 from public.allowed_domains)
           or lower(split_part(auth.jwt() ->> 'email', '@', 2)) in (select lower(domain) from public.allowed_domains) );
$$;

alter table public.scores          enable row level security;
alter table public.drafts          enable row level security;
alter table public.settings        enable row level security;
alter table public.allowed_domains enable row level security;
alter table public.audit_log       enable row level security;

do $$ declare t text; begin
  foreach t in array array['scores','drafts','settings'] loop
    execute format('drop policy if exists "%1$s read" on public.%1$s', t);
    execute format('drop policy if exists "%1$s insert" on public.%1$s', t);
    execute format('drop policy if exists "%1$s update" on public.%1$s', t);
    execute format('create policy "%1$s read"   on public.%1$s for select to authenticated using (public.is_allowed())', t);
    execute format('create policy "%1$s insert" on public.%1$s for insert to authenticated with check (public.is_allowed())', t);
    execute format('create policy "%1$s update" on public.%1$s for update to authenticated using (public.is_allowed()) with check (public.is_allowed())', t);
  end loop;
end $$;
drop policy if exists "audit read" on public.audit_log;
create policy "audit read" on public.audit_log for select to authenticated using (public.is_allowed());
-- No delete policies: records can be changed but not deleted from the app.

-- 3) Stamp the real editor's email and log every change ---------------------
create or replace function public.stamp_and_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare j jsonb; k text;
begin
  new.updated_by := left(coalesce(nullif(new.updated_by, ''), 'unnamed'), 120);
  new.updated_at := now();
  j := to_jsonb(new);
  k := coalesce(j->>'code', j->>'pid', j->>'id');
  insert into public.audit_log(tbl, key, changed_by, old, new)
  values (tg_table_name, k, new.updated_by,
          case when tg_op = 'UPDATE' then to_jsonb(old) - 'html' else null end,
          j - 'html');
  return new;
end $$;

drop trigger if exists scores_stamp   on public.scores;
drop trigger if exists drafts_stamp   on public.drafts;
drop trigger if exists settings_stamp on public.settings;
create trigger scores_stamp   before insert or update on public.scores   for each row execute function public.stamp_and_log();
create trigger drafts_stamp   before insert or update on public.drafts   for each row execute function public.stamp_and_log();
create trigger settings_stamp before insert or update on public.settings for each row execute function public.stamp_and_log();

-- 4) Live updates between users ---------------------------------------------
do $$ begin
  begin alter publication supabase_realtime add table public.scores;   exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.drafts;   exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.settings; exception when duplicate_object then null; end;
end $$;
