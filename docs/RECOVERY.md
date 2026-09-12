# Backup & Recovery Procedures

## Current State

| Item | Status |
|------|--------|
| Supabase Plan | Free |
| Automatic Daily Backups | ❌ NOT available (Free plan) |
| PITR (Point-in-Time Recovery) | ❌ NOT available (Free plan) |
| Off-site Logical Backups | ✅ IMPLEMENTED (automated via GitHub Actions) |
| Recovery Documentation | ✅ THIS FILE |
| Recovery Test | ⚠️ DEFERRED (requires human-controlled restore) |

## RPO / RTO

| Metric | Target | Current Capability |
|--------|--------|-------------------|
| **RPO** (Recovery Point Objective) | ≤ 24 hours | ~24 hours via daily off-site logical backup |
| **RTO** (Recovery Time Objective) | ≤ 2 hours | Estimated 30-60 minutes for small database restore |

## Free Plan Limitations

The production Supabase project runs on the **Free plan** with these limitations:

- **No automatic daily backups** — Supabase does not back up Free plan projects
- **No PITR** — Cannot restore to a specific point in time
- **Project pauses after 7 days of inactivity** — Must keep the project active
- **500 MB database size limit**
- **Project deletion is permanent** — All data and backups are lost

**Mitigation:** We implement off-site logical backups via GitHub Actions + `supabase db dump`.

## Backup Architecture

```
┌─────────────────┐     supabase db dump      ┌──────────────────┐
│  Production DB   │ ──────────────────────────▶ │  GitHub Actions   │
│  (Supabase Free) │                            │  Artifact Storage  │
└─────────────────┘                            └──────────────────┘
                                                         │
                                                   Daily schedule
                                                   (cron: 0 2 * * *)
                                                         │
                                                         ▼
                                                ┌──────────────────┐
                                                │  Backup Verify    │
                                                │  (pg_restore --if-exists) │
                                                └──────────────────┘
```

**Backup mechanism:** `npx supabase db dump` creates a logical SQL dump of the database.

**Storage:** Backups are stored as GitHub Actions artifacts with 30-day retention.

**Verification:** Each backup is validated by attempting a dry-run restore with `pg_restore`.

## Backup Procedure

### Automated (Daily)

A GitHub Actions workflow (`backup-database.yml`) runs daily at 02:00 UTC:

1. Connects to the production database using `SUPABASE_DB_URL` secret
2. Runs `npx supabase db dump` to create a logical SQL dump
3. Verifies the dump is valid SQL
4. Stores the dump as a GitHub Actions artifact (30-day retention)
5. Reports success/failure in the workflow run

**Required GitHub Secrets:**

| Secret | Purpose |
|--------|---------|
| `SUPABASE_DB_URL` | PostgreSQL connection string for production database |

### Manual (On-demand)

To create a manual backup:

```bash
# Set the database URL (from production Supabase Dashboard → Settings → Database → Connection string)
export SUPABASE_DB_URL="postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres"

# Create the dump
npx supabase db dump --db-url "$SUPABASE_DB_URL" > backup-$(date +%Y%m%d-%H%M%S).sql

# Verify the dump is valid
head -20 backup-*.sql  # Should show SQL header
wc -l backup-*.sql     # Should have meaningful line count
```

## Recovery Procedure

### Scenario A: Accidental Destructive Data Change

```
PREREQUISITE: Human approval required. Never automate production restore.

1. STOP all app usage immediately (inform users of downtime)
2. Identify the exact time of the destructive change
3. Determine which backup to restore from:
   - GitHub Actions → Artifacts → Select backup from before the change
   - Or: Supabase Dashboard → Database → Backups (if on Pro plan)
4. Download the backup SQL file
5. Review the backup contents (ensure it's complete and valid)
6. Get explicit approval from the project owner
7. Connect to the production database
8. Execute the restore:
   psql "$SUPABASE_DB_URL" < backup-[timestamp].sql
9. Verify critical data:
   - SELECT COUNT(*) FROM sales;
   - SELECT COUNT(*) FROM customers;
   - SELECT SUM(total_amount) FROM sales WHERE status = 'completed';
10. Resume app usage
11. Document the incident and recovery
```

### Scenario B: Failed/Incorrect Database Migration

```
PREREQUISITE: Human approval required.

1. Identify the failed migration
2. Check if the migration partially applied:
   - Query pg_stat_user_tables for recent changes
   - Check if new columns/tables exist
3. If migration partially applied:
   - Manually fix via SQL Editor (Supabase Dashboard)
   - Or: restore from backup (Scenario A)
4. If migration created bad objects:
   - DROP the bad objects manually
   - Re-run the corrected migration
5. Verify the schema matches expected state
```

### Scenario C: Database/Project Failure

```
1. Check Supabase status: https://status.supabase.com
2. If Supabase outage: wait for Supabase to resolve
3. If project deleted: data is PERMANENTLY LOST
   - Use off-site backup (Scenario A)
   - If no off-site backup exists: DATA IS UNRECOVERABLE
4. If database corruption: restore from backup (Scenario A)
```

### Scenario D: Need to Restore to Previous Point in Time

```
Without PITR (current state):
- Can only restore to the most recent daily backup
- Data loss = time between backup and desired restore point (up to 24 hours)

With PITR (future, requires Pro plan + PITR add-on):
- Can restore to any point within the retention period
- Data loss = seconds (near-zero)

Current procedure:
1. Select the closest backup BEFORE the desired restore point
2. Follow Scenario A restore steps
3. Accept data loss between backup time and desired point
```

## Production Restore Approval

**Any production database restore REQUIRES explicit human approval.**

Approval checklist:

- [ ] Project owner has been notified
- [ ] Reason for restore is documented
- [ ] Which backup will be restored is identified
- [ ] Expected data loss is calculated
- [ ] Downtime window is communicated to users
- [ ] Backup file has been verified (valid SQL, complete)
- [ ] Rollback plan exists (can re-dump current state before restore)

**This approval process cannot be automated or bypassed.**

## Future: PITR Activation Path

When the business requires stronger recovery capabilities:

### Step 1: Upgrade to Pro Plan ($25/month)

- Enables automatic daily backups (7-day retention)
- Enables PITR add-on

### Step 2: Enable PITR Add-on ($100/month for 7-day retention)

- Enables restore to any point within 7 days
- RPO drops from ~24 hours to seconds
- Requires at least Small compute add-on ($15/month)

### Step 3: Verify PITR

- Test restore to a temporary project
- Verify schema and data integrity
- Document the recovery procedure

### Cost Summary

| Item | Monthly Cost |
|------|-------------|
| Pro Plan | $25 |
| Small Compute | $15 |
| PITR (7-day) | $100 |
| **Total** | **$140/month** |

## Responsibilities

| Responsibility | Owner |
|---------------|-------|
| Monitor backup workflow success | Developer |
| Investigate backup failures | Developer |
| Approve production restores | Project Owner |
| Perform production restores | Developer (with approval) |
| Verify backup integrity | Automated (workflow) |
| Update this document | Developer |
| Decide when to upgrade to Pro | Project Owner |

## Safety Checks

- [ ] Backup workflow runs daily (check GitHub Actions)
- [ ] Backup artifacts are stored (check GitHub Artifacts)
- [ ] Backup files are valid SQL (verified by workflow)
- [ ] Production credentials are never committed to source
- [ ] Restore requires explicit human approval
- [ ] QA and production databases are separate projects
- [ ] No automated restore can overwrite production

## Monitoring

To verify backups are running:

1. Go to GitHub Actions → "Backup Production Database" workflow
2. Check the most recent run status (should be ✅ green)
3. Click into the run to verify the artifact was created
4. Download and inspect a backup file periodically

To set up alerts:

- Configure GitHub Actions notification settings to alert on workflow failure
- Or: Add a Slack/email notification step to the backup workflow

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-09-12 | Initial recovery documentation | Phase 3 - Backup & Recovery |
