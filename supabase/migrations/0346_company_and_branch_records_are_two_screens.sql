-- 0342 — The company and a branch are two records, so each gets its own facts.
--
-- WHY THIS EXISTS (owner, 2026-11-27). Business Profile and Branch Details were being asked to say
-- the same things: a name, an address, a phone. The ERP split is the honest one — the company is
-- the legal entity that answers for every shop (registration, tax numbers, financial year,
-- currency), and a branch is a place people work in (its own code, what kind of place it is, when
-- it is open). This migration adds only the facts that split needs and that the screens will
-- actually show; nothing is duplicated, and nothing is added "for later".
--
--   • companies (shops): the legal/tax identity and the two organisation-wide defaults. The
--     trading name, logo, contact and head office already live on the row.
--   • branches: a short code staff can say out loud, what kind of place it is, and its opening
--     hours. A branch's address, phone, manager and team already exist.
--
-- WRITES GO THROUGH TWO NARROW FUNCTIONS. `set_business_details` writes the five new company
-- columns for an active owner/admin of the current shop; `set_branch_details` writes the four new
-- branch columns only for someone the app's own authorization answers for that branch
-- (`authorize_business_action('settings.edit', …)`, the same call the rest of branch management
-- uses). Both are patches: a key that is absent leaves its column alone, a key present and empty
-- clears an optional fact.
--
-- Additive and replayable: no column is dropped, no row is touched, and both functions replace
-- nothing that already existed.

alter table public.shops
  add column if not exists legal_name           text,
  add column if not exists ntn                  varchar(20),
  add column if not exists strn                 varchar(20),
  add column if not exists financial_year_start date,
  add column if not exists default_currency     varchar(3) not null default 'PKR';

alter table public.shops
  drop constraint if exists shops_ntn_shape;
alter table public.shops
  add constraint shops_ntn_shape check (ntn is null or ntn ~ '^[0-9]{7}(-[0-9])?$');

alter table public.shops
  drop constraint if exists shops_strn_shape;
alter table public.shops
  add constraint shops_strn_shape check (strn is null or strn ~ '^[0-9]{2}-[0-9]{7}-[0-9]$');

alter table public.shops
  drop constraint if exists shops_currency_shape;
alter table public.shops
  add constraint shops_currency_shape check (default_currency ~ '^[A-Z]{3}$');

alter table public.branches
  add column if not exists code        varchar(20),
  add column if not exists branch_type varchar(20) not null default 'store',
  add column if not exists opens_at    time,
  add column if not exists closes_at   time;

alter table public.branches
  drop constraint if exists branches_type_shape;
alter table public.branches
  add constraint branches_type_shape check (branch_type in ('store', 'warehouse', 'outlet', 'office'));

-- A branch code is how staff and drivers name one location; two branches of the same company
-- saying the same code would defeat it. Scoped to the company, never global.
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

create or replace function public.set_branch_details(p_branch_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
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

  perform public.authorize_business_action('settings.edit', v_tenant, p_branch_id);

  update public.branches b
     set code = case
           when p_patch ? 'code' then nullif(upper(btrim(p_patch ->> 'code')), '')
           else b.code end,
         branch_type = case
           when p_patch ? 'branch_type' then coalesce(nullif(btrim(p_patch ->> 'branch_type'), ''), b.branch_type)
           else b.branch_type end,
         opens_at = case
           when p_patch ? 'opens_at' then nullif(p_patch ->> 'opens_at', '')::time
           else b.opens_at end,
         closes_at = case
           when p_patch ? 'closes_at' then nullif(p_patch ->> 'closes_at', '')::time
           else b.closes_at end
   where b.id = p_branch_id;

  return (select to_jsonb(b) from public.branches b where b.id = p_branch_id);
end;
$$;

revoke all on function public.set_branch_details(uuid, jsonb) from public, anon;
grant execute on function public.set_branch_details(uuid, jsonb) to authenticated, service_role;

/*
 * Reading one branch's own record.
 *
 * `get_my_branches()` answers the LIST — the figures and the tags a directory needs — and it is
 * deliberately shaped to that job, so the operational columns added above are read here instead of
 * widened into every branch row the app holds. A member of the business may read a branch of it;
 * anyone else is refused rather than shown an empty record.
 */
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

comment on function public.set_business_details(jsonb) is
  'Writes the company-level facts (legal name, NTN, STRN, financial year, currency) for an active owner/admin of the current business.';
comment on function public.set_branch_details(uuid, jsonb) is
  'Writes one branch''s operational facts (code, type, opening hours) for a caller authorized for that branch.';
