-- Run this once in Supabase → SQL Editor to let the app work WITHOUT login.
-- Anyone with the site link can then read and change scores, drafts and settings.
-- Every change is still recorded in audit_log with the name the person typed.

do $$ declare t text; begin
  foreach t in array array['scores','drafts','settings'] loop
    execute format('drop policy if exists "%1$s public read"   on public.%1$s', t);
    execute format('drop policy if exists "%1$s public insert" on public.%1$s', t);
    execute format('drop policy if exists "%1$s public update" on public.%1$s', t);
    execute format('create policy "%1$s public read"   on public.%1$s for select to anon, authenticated using (true)', t);
    execute format('create policy "%1$s public insert" on public.%1$s for insert to anon, authenticated with check (true)', t);
    execute format('create policy "%1$s public update" on public.%1$s for update to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;

grant select, insert, update on public.scores, public.drafts, public.settings to anon;

-- Keep the typed name as the editor (no login means there is no verified email).
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
