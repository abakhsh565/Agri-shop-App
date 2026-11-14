/**
 * Granting `customers.edit` grants the credit limit too.
 *
 * `0251` added `customers.credit_limit` and backfilled the roles that held `customers.edit` at that
 * moment. That was a one-time copy, so it drifted: QA holds eleven roles (Sales Manager, Inventory
 * Clerk, Staff, two legacy duplicates) that can edit customers but cannot set a credit limit, because
 * they gained `customers.edit` after 0251 ran — through the role editor, through a tenant created
 * later, or through a role restored from an older template.
 *
 * The consequence is a product gap, not a cosmetic one: the Credit Requests screen lets such a role
 * ask the owner for a limit change, and `set_customer_credit_limit` then refuses it with a
 * permission error, so the role appears able to do the job and cannot finish it.
 *
 * The rule the product intends is an invariant, not a migration-time copy: whoever may edit a
 * customer may set their limit. This file re-asserts it for every role that already exists in this
 * database, and it is safe to replay: it inserts only the pairs that are missing and touches no
 * other grant, no role, and no row.
 *
 * Going forward the pair must be granted together (the role editor and `0277`'s default-role seeding
 * both list `customers.credit_limit` beside `customers.edit`); `tests/integration/creditRequest`
 * fails if a system role ever holds one without the other.
 */
INSERT INTO role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, p_new.id
FROM role_permissions rp
JOIN permissions p_old ON p_old.id = rp.permission_id AND p_old.code = 'customers.edit'
CROSS JOIN permissions p_new
WHERE p_new.code = 'customers.credit_limit'
ON CONFLICT DO NOTHING;

-- Assert the invariant this file exists to restore, so a replay on a database where the permission
-- row is missing fails loudly instead of silently inserting nothing.
DO $$
DECLARE
  v_lost integer;
BEGIN
  SELECT count(*)
    INTO v_lost
    FROM role_permissions rp
    JOIN permissions pe ON pe.id = rp.permission_id AND pe.code = 'customers.edit'
   WHERE NOT EXISTS (
     SELECT 1
       FROM role_permissions rp2
       JOIN permissions pn ON pn.id = rp2.permission_id AND pn.code = 'customers.credit_limit'
      WHERE rp2.role_id = rp.role_id
   );

  IF v_lost > 0 THEN
    RAISE EXCEPTION '0311: % role(s) may edit customers but cannot set a credit limit', v_lost;
  END IF;
END;
$$;
