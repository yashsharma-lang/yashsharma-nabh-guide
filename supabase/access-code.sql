-- Shared access code for the NABH Readiness Guide.
-- Run once in Supabase → SQL Editor (after schema.sql). Replaces the open no-login rules.
--
-- >>> EDIT THE CODE ON THE LAST LINE BEFORE RUNNING <<<
-- Use at least 10 characters, e.g. EHBR-Nabh-2026!

create table if not exists public.app_access ( code text primary key );
alter table public.app_access enable row level security;   -- no policies: nobody can read codes from the browser

-- True when the request carries a valid code in the x-access-code header
create or replace function public.code_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.app_access
    where code = coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-access-code', '')
  );
$$;

-- Lets the page and the bot check a code without being able to read it
create or replace function public.check_code(c text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_access where code = c);
$$;
revoke all on function public.check_code(text) from public;
grant execute on function public.check_code(text) to anon, authenticated;

-- Data rules: read and write only with a valid code
do $$ declare t text; begin
  foreach t in array array['scores','drafts','settings'] loop
    execute format('drop policy if exists "%1$s public read"   on public.%1$s', t);
    execute format('drop policy if exists "%1$s public insert" on public.%1$s', t);
    execute format('drop policy if exists "%1$s public update" on public.%1$s', t);
    execute format('drop policy if exists "%1$s code read"     on public.%1$s', t);
    execute format('drop policy if exists "%1$s code insert"   on public.%1$s', t);
    execute format('drop policy if exists "%1$s code update"   on public.%1$s', t);
    execute format('create policy "%1$s code read"   on public.%1$s for select to anon, authenticated using (public.code_ok())', t);
    execute format('create policy "%1$s code insert" on public.%1$s for insert to anon, authenticated with check (public.code_ok())', t);
    execute format('create policy "%1$s code update" on public.%1$s for update to anon, authenticated using (public.code_ok()) with check (public.code_ok())', t);
  end loop;
end $$;
grant select, insert, update on public.scores, public.drafts, public.settings to anon;

-- Keep the typed name as the editor
create or replace function public.stamp_and_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare k text;
begin
  new.updated_by := left(coalesce(auth.jwt() ->> 'email', nullif(new.updated_by, ''), 'unnamed'), 120);
  new.updated_at := now();
  k := case tg_table_name when 'scores' then new.code when 'drafts' then new.pid else new.id end;
  insert into public.audit_log(tbl, key, changed_by, old, new)
  values (tg_table_name, k, new.updated_by,
          case when tg_op = 'UPDATE' then to_jsonb(old) - 'html' else null end,
          to_jsonb(new) - 'html');
  return new;
end $$;

-- Set the code (to change it later: delete from public.app_access; then insert the new one)
insert into public.app_access(code) values ('CHANGE-THIS-CODE') on conflict do nothing;
