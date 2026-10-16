ALTER TABLE public.audit_events ADD COLUMN IF NOT EXISTS actor_name text, ADD COLUMN IF NOT EXISTS branch_name text;
CREATE OR REPLACE FUNCTION public.audit_identity_labels()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
BEGIN
  SELECT name INTO NEW.actor_name FROM public.users WHERE id=NEW.user_id;
  SELECT name INTO NEW.branch_name FROM public.branches WHERE id=NEW.branch_id;
  RETURN NEW;
END;
$$;
-- Trigger names order the context derivation before label snapshotting.
DROP TRIGGER IF EXISTS audit_identity_labels_trg ON public.audit_events;
CREATE TRIGGER audit_identity_labels_trg BEFORE INSERT ON public.audit_events
  FOR EACH ROW EXECUTE FUNCTION public.audit_identity_labels();
CREATE INDEX IF NOT EXISTS audit_events_branch_history_idx ON public.audit_events(tenant_id,branch_id,created_at DESC,id DESC);
CREATE OR REPLACE FUNCTION public.get_branch_activity(p_before timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL,p_limit int DEFAULT 50)
RETURNS TABLE(id uuid,action text,entity_type text,entity_id uuid,actor_id uuid,actor_name text,
  actor_role text,branch_id uuid,branch_name text,details jsonb,created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE v_tenant uuid; v_branch uuid := public.current_branch_id();
BEGIN
  v_tenant := public.authorize_business_action('activity.view');
  RETURN QUERY SELECT a.id,a.action::text,a.entity_type::text,a.entity_id,a.user_id,a.actor_name,
    a.actor_role,a.branch_id,a.branch_name,a.details,a.created_at FROM public.audit_events a
  WHERE a.tenant_id=v_tenant AND a.branch_id=v_branch
    AND (p_before IS NULL OR (a.created_at,a.id)<(p_before,COALESCE(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
  ORDER BY a.created_at DESC,a.id DESC LIMIT greatest(1,least(COALESCE(p_limit,50),100));
END;
$$;
REVOKE ALL ON FUNCTION public.get_branch_activity(timestamptz,uuid,int) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_branch_activity(timestamptz,uuid,int) TO authenticated;
NOTIFY pgrst,'reload schema';
