-- 0207 — the branch/membership/permission model, which existed in no file in this repository.
--
-- WHY THIS FILE EXISTS. The signed-in app reads eight relations production does not have, and six of
-- them — branches, roles, memberships, permissions, role_permissions, user_permissions — were created
-- by no tracked SQL at all: not by any of the 206 migrations, not by COMPLETE_DATABASE_SETUP.sql, not by
-- ALL_MIGRATIONS_TO_RUN.sql. They existed only inside environment dumps. This file records them,
-- schema-only, so the production gap can be closed by a reviewed, verified forward file instead of by
-- hand in a SQL editor.
--
-- PROVENANCE, and the owner decision behind it. The DDL in this file was extracted from the accepted
-- staging baseline (backups/backup-staging-bpybjrjenwccowvtrevu-2026-10-15T14-11-09.sql) under the
-- owner decision of 2026-10-16, recorded in docs/PRODUCTION_MIGRATION_PLAN.md §7.2. Every data
-- statement in that dump was skipped: no row moves from any environment to any other. What moves is
-- schema, and PRODUCTION_DATA_POLICY.md §1 already states the direction — "code and schema move
-- forward; DATA never moves up".
--
-- VERIFIED, not merely written. `npm run verify:baseline -- --baseline production --files <this file>`
-- replays it onto production's own accepted baseline, artifact sha256 verified, with all 268 of that
-- dump's data statements counted and skipped:
--
--     SUMMARY PASS: 1 files, 76 statements, 0 sql failures, 0 env-gap failures
--
-- The closure is deliberate: the seven relations need three enum types (membership_role,
-- membership_status, user_role) and eleven functions (the RLS/trigger helpers and resolve_active_shop,
-- which reads user_active_shops). Each function is emitted AFTER the ones it calls, because a SQL
-- function body is validated at creation time — that ordering, not the dump's, is what makes the file
-- apply cleanly.
--
-- WHAT IT DELIBERATELY DOES NOT DO: nothing is dropped, renamed, retyped or narrowed; every table is
-- `if not exists`; no access is widened (the policies here are the tenant-scoped ones, not permissive
-- replacements); and no data statement of any kind appears below.
do $$ begin create type public."membership_role" as enum ('owner', 'admin', 'employee');
exception when duplicate_object then null; end $$;

do $$ begin create type public."membership_status" as enum ('active', 'suspended', 'pending');
exception when duplicate_object then null; end $$;

do $$ begin create type public."user_role" as enum ('admin', 'employee');
exception when duplicate_object then null; end $$;

create table if not exists public."branches" (
  "id" uuid default gen_random_uuid() not null,
  "tenant_id" uuid not null,
  "name" character varying not null,
  "is_default" boolean default false not null,
  "address" text,
  "phone" character varying,
  "is_active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "latitude" double precision,
  "longitude" double precision,
  "location_label" text,
  "location_source" text,
  constraint "branches_pkey" primary key (id)
);

create table if not exists public."memberships" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid not null,
  "tenant_id" uuid not null,
  "role" membership_role default 'employee'::membership_role not null,
  "status" membership_status default 'active'::membership_status not null,
  "branch_scope" uuid[],
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "role_id" uuid,
  constraint "memberships_pkey" primary key (id)
);

create table if not exists public."permissions" (
  "id" uuid default gen_random_uuid() not null,
  "code" character varying(100) not null,
  "module" character varying(50) not null,
  "action" character varying(50) not null,
  "label_en" character varying(200) not null,
  "label_ur" character varying(200) not null,
  "created_at" timestamp with time zone default now() not null,
  constraint "permissions_pkey" primary key (id)
);

create table if not exists public."role_permissions" (
  "id" uuid default gen_random_uuid() not null,
  "role_id" uuid not null,
  "permission_id" uuid not null,
  "created_at" timestamp with time zone default now() not null,
  constraint "role_permissions_pkey" primary key (id)
);

create table if not exists public."roles" (
  "id" uuid default gen_random_uuid() not null,
  "tenant_id" uuid not null,
  "name" character varying(100) not null,
  "description" text,
  "is_system" boolean default false not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  constraint "roles_pkey" primary key (id)
);

create table if not exists public."user_active_shops" (
  "user_id" uuid not null,
  "shop_id" uuid not null,
  "updated_at" timestamp with time zone default now() not null,
  "branch_id" uuid,
  constraint "user_active_shops_pkey" primary key (user_id)
);

create table if not exists public."user_permissions" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid not null,
  "permission_id" uuid not null,
  "granted_by" uuid,
  "granted_at" timestamp with time zone default now() not null,
  "is_override" boolean default false not null,
  "is_granted" boolean default true not null,
  constraint "user_permissions_pkey" primary key (id)
);

do $$ begin
  if not exists (select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid
                  join pg_namespace n on n.oid = t.relnamespace
                  where n.nspname = 'public' and t.relname = 'branches' and c.conname = 'branches_location_in_pakistan') then
    alter table public."branches" add constraint "branches_location_in_pakistan" CHECK ((((latitude IS NULL) AND (longitude IS NULL)) OR ((latitude IS NOT NULL) AND (longitude IS NOT NULL) AND ((latitude >= (23.0)::double precision) AND (latitude <= (37.5)::double precision)) AND ((longitude >= (60.0)::double precision) AND (longitude <= (78.0)::double precision)))));
  end if;
exception when duplicate_object or duplicate_table or duplicate_column or undefined_column then null;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid
                  join pg_namespace n on n.oid = t.relnamespace
                  where n.nspname = 'public' and t.relname = 'branches' and c.conname = 'branches_tenant_id_fkey') then
    alter table public."branches" add constraint "branches_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES shops(id) ON DELETE CASCADE;
  -- An FK on a column this environment has not added yet is the one tolerated case: the
  -- column belongs to a later migration, and an environment already past that migration
  -- holds the constraint already. Production, which is behind, gets it from here.
  end if;
exception when duplicate_object or duplicate_table or duplicate_column or undefined_column then null;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid
                  join pg_namespace n on n.oid = t.relnamespace
                  where n.nspname = 'public' and t.relname = 'memberships' and c.conname = 'memberships_branch_scope_not_empty') then
    alter table public."memberships" add constraint "memberships_branch_scope_not_empty" CHECK (((branch_scope IS NULL) OR (cardinality(branch_scope) > 0)));
  end if;
exception when duplicate_object or duplicate_table or duplicate_column or undefined_column then null;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid
                  join pg_namespace n on n.oid = t.relnamespace
                  where n.nspname = 'public' and t.relname = 'memberships' and c.conname = 'memberships_role_id_fkey') then
    alter table public."memberships" add constraint "memberships_role_id_fkey" FOREIGN KEY (role_id) REFERENCES roles(id);
  -- An FK on a column this environment has not added yet is the one tolerated case: the
  -- column belongs to a later migration, and an environment already past that migration
  -- holds the constraint already. Production, which is behind, gets it from here.
  end if;
exception when duplicate_object or duplicate_table or duplicate_column or undefined_column then null;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid
                  join pg_namespace n on n.oid = t.relnamespace
                  where n.nspname = 'public' and t.relname = 'memberships' and c.conname = 'memberships_tenant_id_fkey') then
    alter table public."memberships" add constraint "memberships_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES shops(id) ON DELETE CASCADE;
  -- An FK on a column this environment has not added yet is the one tolerated case: the
  -- column belongs to a later migration, and an environment already past that migration
  -- holds the constraint already. Production, which is behind, gets it from here.
  end if;
exception when duplicate_object or duplicate_table or duplicate_column or undefined_column then null;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid
                  join pg_namespace n on n.oid = t.relnamespace
                  where n.nspname = 'public' and t.relname = 'memberships' and c.conname = 'memberships_user_id_fkey') then
    alter table public."memberships" add constraint "memberships_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  -- An FK on a column this environment has not added yet is the one tolerated case: the
  -- column belongs to a later migration, and an environment already past that migration
  -- holds the constraint already. Production, which is behind, gets it from here.
  end if;
exception when duplicate_object or duplicate_table or duplicate_column or undefined_column then null;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid
                  join pg_namespace n on n.oid = t.relnamespace
                  where n.nspname = 'public' and t.relname = 'memberships' and c.conname = 'memberships_user_id_tenant_id_key') then
    alter table public."memberships" add constraint "memberships_user_id_tenant_id_key" UNIQUE (user_id, tenant_id);
  end if;
exception when duplicate_object or duplicate_table or duplicate_column or undefined_column then null;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid
                  join pg_namespace n on n.oid = t.relnamespace
                  where n.nspname = 'public' and t.relname = 'permissions' and c.conname = 'permissions_code_key') then
    alter table public."permissions" add constraint "permissions_code_key" UNIQUE (code);
  end if;
exception when duplicate_object or duplicate_table or duplicate_column or undefined_column then null;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid
                  join pg_namespace n on n.oid = t.relnamespace
                  where n.nspname = 'public' and t.relname = 'role_permissions' and c.conname = 'role_permissions_permission_id_fkey') then
    alter table public."role_permissions" add constraint "role_permissions_permission_id_fkey" FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE;
  -- An FK on a column this environment has not added yet is the one tolerated case: the
  -- column belongs to a later migration, and an environment already past that migration
  -- holds the constraint already. Production, which is behind, gets it from here.
  end if;
exception when duplicate_object or duplicate_table or duplicate_column or undefined_column then null;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid
                  join pg_namespace n on n.oid = t.relnamespace
                  where n.nspname = 'public' and t.relname = 'role_permissions' and c.conname = 'role_permissions_role_id_fkey') then
    alter table public."role_permissions" add constraint "role_permissions_role_id_fkey" FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE;
  -- An FK on a column this environment has not added yet is the one tolerated case: the
  -- column belongs to a later migration, and an environment already past that migration
  -- holds the constraint already. Production, which is behind, gets it from here.
  end if;
exception when duplicate_object or duplicate_table or duplicate_column or undefined_column then null;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid
                  join pg_namespace n on n.oid = t.relnamespace
                  where n.nspname = 'public' and t.relname = 'role_permissions' and c.conname = 'role_permissions_role_id_permission_id_key') then
    alter table public."role_permissions" add constraint "role_permissions_role_id_permission_id_key" UNIQUE (role_id, permission_id);
  end if;
exception when duplicate_object or duplicate_table or duplicate_column or undefined_column then null;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid
                  join pg_namespace n on n.oid = t.relnamespace
                  where n.nspname = 'public' and t.relname = 'roles' and c.conname = 'roles_tenant_id_fkey') then
    alter table public."roles" add constraint "roles_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES shops(id) ON DELETE CASCADE;
  -- An FK on a column this environment has not added yet is the one tolerated case: the
  -- column belongs to a later migration, and an environment already past that migration
  -- holds the constraint already. Production, which is behind, gets it from here.
  end if;
exception when duplicate_object or duplicate_table or duplicate_column or undefined_column then null;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid
                  join pg_namespace n on n.oid = t.relnamespace
                  where n.nspname = 'public' and t.relname = 'roles' and c.conname = 'roles_tenant_id_name_key') then
    alter table public."roles" add constraint "roles_tenant_id_name_key" UNIQUE (tenant_id, name);
  end if;
exception when duplicate_object or duplicate_table or duplicate_column or undefined_column then null;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid
                  join pg_namespace n on n.oid = t.relnamespace
                  where n.nspname = 'public' and t.relname = 'user_active_shops' and c.conname = 'user_active_shops_branch_id_fkey') then
    alter table public."user_active_shops" add constraint "user_active_shops_branch_id_fkey" FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL;
  -- An FK on a column this environment has not added yet is the one tolerated case: the
  -- column belongs to a later migration, and an environment already past that migration
  -- holds the constraint already. Production, which is behind, gets it from here.
  end if;
exception when duplicate_object or duplicate_table or duplicate_column or undefined_column then null;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid
                  join pg_namespace n on n.oid = t.relnamespace
                  where n.nspname = 'public' and t.relname = 'user_active_shops' and c.conname = 'user_active_shops_shop_id_fkey') then
    alter table public."user_active_shops" add constraint "user_active_shops_shop_id_fkey" FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE;
  -- An FK on a column this environment has not added yet is the one tolerated case: the
  -- column belongs to a later migration, and an environment already past that migration
  -- holds the constraint already. Production, which is behind, gets it from here.
  end if;
exception when duplicate_object or duplicate_table or duplicate_column or undefined_column then null;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid
                  join pg_namespace n on n.oid = t.relnamespace
                  where n.nspname = 'public' and t.relname = 'user_active_shops' and c.conname = 'user_active_shops_user_id_fkey') then
    alter table public."user_active_shops" add constraint "user_active_shops_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  -- An FK on a column this environment has not added yet is the one tolerated case: the
  -- column belongs to a later migration, and an environment already past that migration
  -- holds the constraint already. Production, which is behind, gets it from here.
  end if;
exception when duplicate_object or duplicate_table or duplicate_column or undefined_column then null;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid
                  join pg_namespace n on n.oid = t.relnamespace
                  where n.nspname = 'public' and t.relname = 'user_permissions' and c.conname = 'user_permissions_granted_by_fkey') then
    alter table public."user_permissions" add constraint "user_permissions_granted_by_fkey" FOREIGN KEY (granted_by) REFERENCES users(id);
  -- An FK on a column this environment has not added yet is the one tolerated case: the
  -- column belongs to a later migration, and an environment already past that migration
  -- holds the constraint already. Production, which is behind, gets it from here.
  end if;
exception when duplicate_object or duplicate_table or duplicate_column or undefined_column then null;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid
                  join pg_namespace n on n.oid = t.relnamespace
                  where n.nspname = 'public' and t.relname = 'user_permissions' and c.conname = 'user_permissions_permission_id_fkey') then
    alter table public."user_permissions" add constraint "user_permissions_permission_id_fkey" FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE;
  -- An FK on a column this environment has not added yet is the one tolerated case: the
  -- column belongs to a later migration, and an environment already past that migration
  -- holds the constraint already. Production, which is behind, gets it from here.
  end if;
exception when duplicate_object or duplicate_table or duplicate_column or undefined_column then null;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid
                  join pg_namespace n on n.oid = t.relnamespace
                  where n.nspname = 'public' and t.relname = 'user_permissions' and c.conname = 'user_permissions_user_id_fkey') then
    alter table public."user_permissions" add constraint "user_permissions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  -- An FK on a column this environment has not added yet is the one tolerated case: the
  -- column belongs to a later migration, and an environment already past that migration
  -- holds the constraint already. Production, which is behind, gets it from here.
  end if;
exception when duplicate_object or duplicate_table or duplicate_column or undefined_column then null;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid
                  join pg_namespace n on n.oid = t.relnamespace
                  where n.nspname = 'public' and t.relname = 'user_permissions' and c.conname = 'user_permissions_user_id_permission_id_key') then
    alter table public."user_permissions" add constraint "user_permissions_user_id_permission_id_key" UNIQUE (user_id, permission_id);
  end if;
exception when duplicate_object or duplicate_table or duplicate_column or undefined_column then null;
end $$;

create index if not exists idx_branches_tenant ON public.branches USING btree (tenant_id);

create index if not exists idx_memberships_tenant ON public.memberships USING btree (tenant_id);

create index if not exists idx_memberships_user ON public.memberships USING btree (user_id);

create index if not exists idx_permissions_module ON public.permissions USING btree (module);

create index if not exists idx_role_permissions_role ON public.role_permissions USING btree (role_id);

create index if not exists idx_roles_tenant ON public.roles USING btree (tenant_id);

create index if not exists idx_user_permissions_override ON public.user_permissions USING btree (user_id, is_override, is_granted);

create index if not exists idx_user_permissions_user ON public.user_permissions USING btree (user_id);

CREATE OR REPLACE FUNCTION public.app_current_user_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT NULLIF(NULLIF(current_setting('request.jwt.claims', true), '')::json->>'sub', '')::uuid;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_active_shop(p_user_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    -- The user's own selection — honoured only if the membership is still active.
    (SELECT uas.shop_id
       FROM user_active_shops uas
       JOIN memberships m
         ON m.user_id = uas.user_id
        AND m.tenant_id = uas.shop_id
        AND m.status = 'active'
      WHERE uas.user_id = p_user_id),
    -- No usable selection: the behaviour every caller had before multi-shop existed.
    (SELECT m.tenant_id
       FROM memberships m
      WHERE m.user_id = p_user_id AND m.status = 'active'
      ORDER BY m.created_at ASC
      LIMIT 1),
    -- Legacy: accounts that predate memberships.
    (SELECT u.shop_id FROM users u WHERE u.id = p_user_id)
  );
$function$;

CREATE OR REPLACE FUNCTION public.current_shop_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ SELECT public.resolve_active_shop(app_current_user_id()); $function$;

CREATE OR REPLACE FUNCTION public.membership_in_active_shop(p_user_id uuid DEFAULT NULL::uuid)
 RETURNS memberships
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT m.*
    FROM memberships m
   WHERE m.user_id = COALESCE(p_user_id, app_current_user_id())
     AND m.tenant_id = public.current_shop_id()
     AND m.status = 'active'
   LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.allowed_branch_scope()
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN m.role = 'owner' THEN NULL::uuid[]
              ELSE COALESCE(m.branch_scope, '{}'::uuid[]) END
    FROM public.membership_in_active_shop(NULL) m
  UNION ALL
  SELECT '{}'::uuid[] WHERE NOT EXISTS (
    SELECT 1 FROM public.membership_in_active_shop(NULL)
  );
$function$;

CREATE OR REPLACE FUNCTION public.app_is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT m.role IN ('owner', 'admin') FROM public.membership_in_active_shop(NULL) m),
    (SELECT EXISTS (
       SELECT 1 FROM users u
        WHERE u.id = app_current_user_id() AND u.role = 'admin' AND u.is_active))
  );
$function$;

CREATE OR REPLACE FUNCTION public.audit_branch_selection()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.app_current_user_id() IS NULL OR NEW.branch_id IS NULL OR
     NEW.user_id IS DISTINCT FROM public.app_current_user_id() THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW.branch_id IS NOT DISTINCT FROM OLD.branch_id AND NEW.shop_id IS NOT DISTINCT FROM OLD.shop_id THEN RETURN NEW; END IF;
  INSERT INTO public.audit_events(user_id,action,entity_type,entity_id,branch_id,details)
  VALUES(public.app_current_user_id(),'branch_selected','branch',NEW.branch_id,NEW.branch_id,
    jsonb_build_object('before',CASE WHEN TG_OP='UPDATE' THEN OLD.branch_id ELSE NULL END,'after',NEW.branch_id));
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.audit_membership_access_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.app_current_user_id() IS NULL OR NOT EXISTS(SELECT 1 FROM public.membership_in_active_shop(NULL)) OR
    (NEW.role_id IS NOT DISTINCT FROM OLD.role_id AND NEW.branch_scope IS NOT DISTINCT FROM OLD.branch_scope AND
      NEW.status IS NOT DISTINCT FROM OLD.status) THEN RETURN NEW; END IF;
  INSERT INTO public.audit_events(user_id,action,entity_type,entity_id,details)
  VALUES(public.app_current_user_id(),'membership_access_changed','user',NEW.user_id,
    jsonb_build_object('before',jsonb_build_object('roleId',OLD.role_id,'branchScope',OLD.branch_scope,'status',OLD.status),
      'after',jsonb_build_object('roleId',NEW.role_id,'branchScope',NEW.branch_scope,'status',NEW.status)));
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.clear_active_shop_on_membership_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM user_active_shops
   WHERE user_id = OLD.user_id AND shop_id = OLD.tenant_id;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_memberships_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validate_member_branch_scope()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.branch_scope IS NOT DISTINCT FROM OLD.branch_scope
     AND NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id AND NEW.role IS NOT DISTINCT FROM OLD.role THEN RETURN NEW; END IF;
  IF NEW.role = 'owner' THEN RETURN NEW; END IF;
  -- Lock the target branches rather than serializing all business operations.
  -- Archive holds FOR UPDATE on its branch; a racing assignment waits and then
  -- re-checks is_active. No reverse membership lock is taken by archive.
  PERFORM 1 FROM public.branches WHERE tenant_id=NEW.tenant_id
    AND id=ANY(COALESCE(NEW.branch_scope,'{}'::uuid[])) ORDER BY id FOR SHARE;
  IF TG_OP = 'INSERT' AND NEW.branch_scope IS NULL THEN RETURN NEW; END IF;
  IF NEW.branch_scope IS NULL OR cardinality(NEW.branch_scope) = 0 OR EXISTS (
    SELECT 1 FROM unnest(NEW.branch_scope) x WHERE x IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.branches b WHERE b.id = x AND b.tenant_id = NEW.tenant_id AND b.is_active
    )
  ) THEN RAISE EXCEPTION 'INVALID_BRANCH_SCOPE: explicit branches are required'; END IF;
  RETURN NEW;
END;
$function$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'audit_branch_selection_trg' and tgrelid = 'public.user_active_shops'::regclass) then
    execute $trg$create trigger "audit_branch_selection_trg" AFTER INSERT OR UPDATE on public.user_active_shops FOR EACH ROW EXECUTE FUNCTION audit_branch_selection()$trg$;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'audit_membership_access_change_trg' and tgrelid = 'public.memberships'::regclass) then
    execute $trg$create trigger "audit_membership_access_change_trg" AFTER UPDATE on public.memberships FOR EACH ROW EXECUTE FUNCTION audit_membership_access_change()$trg$;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'clear_active_shop_on_membership_delete_trg' and tgrelid = 'public.memberships'::regclass) then
    execute $trg$create trigger "clear_active_shop_on_membership_delete_trg" AFTER DELETE on public.memberships FOR EACH ROW EXECUTE FUNCTION clear_active_shop_on_membership_delete()$trg$;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'memberships_updated_at' and tgrelid = 'public.memberships'::regclass) then
    execute $trg$create trigger "memberships_updated_at" BEFORE UPDATE on public.memberships FOR EACH ROW EXECUTE FUNCTION update_memberships_updated_at()$trg$;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'validate_member_branch_scope_trg' and tgrelid = 'public.memberships'::regclass) then
    execute $trg$create trigger "validate_member_branch_scope_trg" BEFORE INSERT OR UPDATE on public.memberships FOR EACH ROW EXECUTE FUNCTION validate_member_branch_scope()$trg$;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'branches' and policyname = 'branches_select_tenant') then
    execute $policy$create policy "branches_select_tenant" on public."branches" for SELECT to authenticated using (((tenant_id = current_shop_id()) AND ((allowed_branch_scope() IS NULL) OR (id = ANY (allowed_branch_scope())))))$policy$;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'memberships' and policyname = 'memberships_select_own') then
    execute $policy$create policy "memberships_select_own" on public."memberships" for SELECT to public using ((user_id = (NULLIF(((current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text), ''::text))::uuid))$policy$;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'memberships' and policyname = 'memberships_select_tenant_admin') then
    execute $policy$create policy "memberships_select_tenant_admin" on public."memberships" for SELECT to authenticated using (((tenant_id = current_shop_id()) AND app_is_admin()))$policy$;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'permissions' and policyname = 'permissions_select') then
    execute $policy$create policy "permissions_select" on public."permissions" for SELECT to public using (true)$policy$;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'role_permissions' and policyname = 'role_permissions_delete') then
    execute $policy$create policy "role_permissions_delete" on public."role_permissions" for DELETE to public using (((EXISTS ( SELECT 1
   FROM roles r
  WHERE ((r.id = role_permissions.role_id) AND (r.tenant_id = current_shop_id())))) AND (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = app_current_user_id()) AND (u.role = 'admin'::user_role))))))$policy$;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'role_permissions' and policyname = 'role_permissions_insert') then
    execute $policy$create policy "role_permissions_insert" on public."role_permissions" for INSERT to public with check (((EXISTS ( SELECT 1
   FROM roles r
  WHERE ((r.id = role_permissions.role_id) AND (r.tenant_id = current_shop_id())))) AND (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = app_current_user_id()) AND (u.role = 'admin'::user_role))))))$policy$;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'role_permissions' and policyname = 'role_permissions_select') then
    execute $policy$create policy "role_permissions_select" on public."role_permissions" for SELECT to public using ((EXISTS ( SELECT 1
   FROM roles r
  WHERE ((r.id = role_permissions.role_id) AND (r.tenant_id = current_shop_id())))))$policy$;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'roles' and policyname = 'roles_delete') then
    execute $policy$create policy "roles_delete" on public."roles" for DELETE to public using (((tenant_id = current_shop_id()) AND (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = app_current_user_id()) AND (u.role = 'admin'::user_role)))) AND (NOT is_system)))$policy$;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'roles' and policyname = 'roles_insert') then
    execute $policy$create policy "roles_insert" on public."roles" for INSERT to public with check (((tenant_id = current_shop_id()) AND (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = app_current_user_id()) AND (u.role = 'admin'::user_role))))))$policy$;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'roles' and policyname = 'roles_select') then
    execute $policy$create policy "roles_select" on public."roles" for SELECT to public using ((tenant_id = current_shop_id()))$policy$;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'roles' and policyname = 'roles_update') then
    execute $policy$create policy "roles_update" on public."roles" for UPDATE to public using (((tenant_id = current_shop_id()) AND (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = app_current_user_id()) AND (u.role = 'admin'::user_role))))))$policy$;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_active_shops' and policyname = 'user_active_shops_select_own') then
    execute $policy$create policy "user_active_shops_select_own" on public."user_active_shops" for SELECT to public using ((user_id = app_current_user_id()))$policy$;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_permissions' and policyname = 'user_permissions_delete') then
    execute $policy$create policy "user_permissions_delete" on public."user_permissions" for DELETE to public using ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (NULLIF(((current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text), ''::text))::uuid) AND (u.role = 'admin'::user_role)))))$policy$;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_permissions' and policyname = 'user_permissions_insert') then
    execute $policy$create policy "user_permissions_insert" on public."user_permissions" for INSERT to public with check ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (NULLIF(((current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text), ''::text))::uuid) AND (u.role = 'admin'::user_role)))))$policy$;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_permissions' and policyname = 'user_permissions_select') then
    execute $policy$create policy "user_permissions_select" on public."user_permissions" for SELECT to public using (((user_id = (NULLIF(((current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text), ''::text))::uuid) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (NULLIF(((current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text), ''::text))::uuid) AND (u.role = 'admin'::user_role) AND (u.shop_id = ( SELECT users.shop_id
           FROM users
          WHERE (users.id = user_permissions.user_id))))))))$policy$;
  end if;
end $$;

alter table public."branches" enable row level security;

alter table public."memberships" enable row level security;

alter table public."permissions" enable row level security;

alter table public."role_permissions" enable row level security;

alter table public."roles" enable row level security;

alter table public."user_active_shops" enable row level security;

alter table public."user_permissions" enable row level security;
