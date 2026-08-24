-- 0006_notification_audience.sql
-- ---------------------------------------------------------------------------
-- Persona-aware notification visibility.
--
-- Both personas share ONE live notifications feed, but each sees only what is
-- relevant and permitted for their role:
--   * Admin / Owner  → every event, including supplier-financial events.
--   * Employee       → operational events only (their own daily work): sales,
--                      customer payments, returns, stock adjustments, and
--                      low-stock alerts.
--
-- Employees must NEVER receive supplier financials or purchase/base cost
-- (AGENTS.md non-negotiable). The `purchase` notification body carries the
-- supplier cost total, so it is admin-only. Authorization is enforced in the
-- DATABASE here (RLS), not merely by hiding UI — the Realtime stream honours
-- this same policy, so an employee's device never receives admin-only rows.
--
-- Idempotent: safe to re-run. Depends only on objects created by 0003
-- (the `notifications` table with a `kind` column and the `app_is_admin()`
-- helper), so it can run standalone after 0003/0004.
-- ---------------------------------------------------------------------------

drop policy if exists notifications_read on notifications;

create policy notifications_read on notifications
  for select to authenticated
  using (
    app_is_admin()
    or kind in ('sale', 'payment', 'return', 'stock_adjust', 'low_stock')
  );
