# Automatic Reminder Delivery — Setup Guide

## What This Does

This Edge Function runs **automatically every day at 08:00 UTC** via Supabase pg_cron. It:

1. Evaluates all active reminder configs for customers with outstanding balance
2. Calculates whether each reminder should fire based on the configured anchor + days offset
3. Creates reminder log entries that appear as "Ready to Send" in the app
4. The owner can then review and send them manually via WhatsApp/SMS

## Setup Steps

### Step 1: Run the Migration

In your **Supabase Dashboard → SQL Editor**, run:

```sql
supabase/migrations/0034_due_date_past_restriction.sql
```

This adds:
- `due_date_not_past` CHECK constraint (rejects past due dates)
- `process_reminders()` PostgreSQL function
- `pg_cron` job that runs daily at 08:00 UTC

### Step 2: Deploy the Edge Function (Optional — for WhatsApp delivery)

If you want automatic WhatsApp/SMS delivery (not just log entries):

```bash
# Install Supabase CLI if not already installed
npm install -g supabase

# Login to Supabase
supabase login

# Link to your project
supabase link --project-ref YOUR_PROJECT_REF

# Deploy the function
supabase functions deploy process-reminders
```

### Step 3: Configure WhatsApp Business API (Optional)

To send actual WhatsApp messages, you need:

1. A **WhatsApp Business API** account (via Meta or a provider like Twilio)
2. Set the API key as a Supabase secret:
   ```bash
   supabase secrets set WHATSAPP_API_KEY=your_key_here
   ```
3. Update the Edge Function to call the WhatsApp API instead of just creating log entries

### Step 4: Verify It Works

1. Create a customer with a due date in the past (e.g., yesterday)
2. Add a reminder config (e.g., "1 day after due date")
3. Wait for the next 08:00 UTC run, or manually trigger:
   ```sql
   SELECT process_reminders();
   ```
4. Check the `reminder_logs` table — a new entry should appear
5. Open the app → Reminders page → "Ready to Send" tab should show the new entry

## How It Works

### pg_cron Schedule
- **Job name:** `daily-reminder-check`
- **Schedule:** `0 8 * * *` (daily at 08:00 UTC)
- **Function:** `process_reminders()`

### Reminder Evaluation Logic

For each customer with outstanding balance:
1. Skip if no due date set
2. Skip if due date is still in the future
3. For each active reminder config:
   - Calculate trigger date based on anchor type
   - Skip if trigger date hasn't been reached
   - Check stop conditions (paid, count limit, date limit)
   - Determine escalation tone (gentle/firmer/final)
   - Skip if already sent today
   - Create reminder log entry

### Anchor Types
- **before_due:** `due_date - start_days`
- **after_due:** `due_date + start_days`
- **after_credit:** `latest_credit_sale_date + start_days`
- **before_harvest:** `next_harvest_date - start_days`

### Stop Conditions
- **paid:** Customer has zero outstanding balance
- **count:** Reached `ends_count` number of reminders
- **date:** Past the configured `ends_date`

## Current Limitation

The **pg_cron function** creates reminder log entries but does NOT automatically send WhatsApp/SMS messages. The owner still needs to:

1. Open the app
2. Check the "Ready to Send" tab
3. Manually click "Send" via WhatsApp/SMS

For **fully automatic WhatsApp delivery**, you need the Edge Function + WhatsApp Business API integration.

## Testing

```sql
-- Check if pg_cron is running
SELECT * FROM cron.job;

-- Manually trigger the reminder processor
SELECT process_reminders();

-- Check created reminders
SELECT * FROM reminder_logs WHERE channel = 'auto_generated' ORDER BY sent_at DESC LIMIT 10;

-- Check the cron job schedule
SELECT * FROM cron.schedule;

-- Remove the cron job (if needed)
SELECT cron.unschedule('daily-reminder-check');
```
