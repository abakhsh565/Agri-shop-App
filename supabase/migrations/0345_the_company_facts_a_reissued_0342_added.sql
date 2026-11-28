-- 0345 — the company facts a re-issued 0342 added, applied where 0342 already ran.
--
-- WHY THIS EXISTS. `0342` was applied to QA from an earlier copy of the file and then edited on
-- `dev` (the legal/tax write gained the registration number, and the branch reader was added). A
-- recorded migration is never rewritten in place, so the difference is carried forward here: the
-- same objects, safe to run on an environment that already has most of them, and a no-op for one
-- that has none.
--
-- Nothing new is introduced. Every statement is `if not exists` / `create or replace`, the grants
-- are re-issued, and no row, policy or column is dropped.

alter table public.shops
  add column if not exists legal_name           text,
  add column if not exists ntn                  varchar(20),
  add column if not exists strn                 varchar(20),
  add column if not exists financial_year_start date,
  add column if not exists default_currency     varchar(3) not null default 'PKR';

alter table public.branches
  add column if not exists code        varchar(20),
  add column if not exists branch_type varchar(20) not null default 'store',
  add column if not exists opens_at    time,
  add column if not exists closes_at   time;

create unique index if not exists branches_tenant_code_key
  on public.branches (tenant_id, upper(code))
  where code is not null;

create or replace function public.set_business_details(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor uuid := app_current_user_id();
  v_shop  uuid := current_shop_id();
begin
  if v_actor is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if v_shop is null then
    raise exception 'NOT_AUTHORIZED: no business in context';
  end if;
  if not exists (
    select 1
      from public.memberships m
     where m.user_id = v_actor
       and m.tenant_id = v_shop
       and m.status = 'active'
       and m.role in ('owner', 'admin')
  ) then
    raise exception 'NOT_AUTHORIZED: the company record belongs to the people who answer for it';
  end if;

  update public.shops s
     set legal_name = case
           when p_patch ? 'legal_name' then nullif(btrim(p_patch ->> 'legal_name'), '')
           else s.legal_name end,
         ntn = case
           when p_patch ? 'ntn' then nullif(btrim(p_patch ->> 'ntn'), '')
           else s.ntn end,
         registration_number = case
           when p_patch ? 'registration' then nullif(btrim(p_patch ->> 'registration'), '')
           else s.registration_number end,
         strn = case
           when p_patch ? 'strn' then nullif(btrim(p_patch ->> 'strn'), '')
           else s.strn end,
         financial_year_start = case
           when p_patch ? 'financial_year_start'
             then nullif(p_patch ->> 'financial_year_start', '')::date
           else s.financial_year_start end,
         default_currency = case
           when p_patch ? 'currency' then coalesce(nullif(upper(btrim(p_patch ->> 'currency')), ''), s.default_currency)
           else s.default_currency end
   where s.id = v_shop;

  return (select to_jsonb(s) from public.shops s where s.id = v_shop);
end;
$$;

revoke all on function public.set_business_details(jsonb) from public, anon;
grant execute on function public.set_business_details(jsonb) to authenticated, service_role;

create or replace function public.get_branch_record(p_branch_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_actor  uuid := app_current_user_id();
  v_tenant uuid;
begin
  if v_actor is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select b.tenant_id into v_tenant from public.branches b where b.id = p_branch_id;
  if v_tenant is null then
    raise exception 'NOT_FOUND';
  end if;

  if not exists (
    select 1 from public.memberships m
     where m.user_id = v_actor
       and m.tenant_id = v_tenant
       and m.status = 'active'
  ) then
    raise exception 'NOT_AUTHORIZED: this branch belongs to another business';
  end if;

  return (select to_jsonb(b) from public.branches b where b.id = p_branch_id);
end;
$$;

revoke all on function public.get_branch_record(uuid) from public, anon;
grant execute on function public.get_branch_record(uuid) to authenticated, service_role;
