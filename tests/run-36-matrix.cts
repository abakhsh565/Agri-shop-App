// Stub import.meta.env for Node/tsx so Vite-dependent modules load
import './env-stub.cjs';
import { createClient } from '@supabase/supabase-js';
import { generateReminders, loadReminderConfigs, saveReminderConfig, loadBusinessSettings, loadCustomerCrops, saveCustomerCrops } from '../src/lib/reminderEngine.ts';

const sb = createClient('https://gkswcfljxlutkfdvvqng.supabase.co', 'sb_publishable_8YFs0RuSeAkISC3oqj-aUg_uNnSosxG');

const SUFFIX = String(Date.now()).slice(-5);
const TODAY = '2026-09-05';
const FUTURE_DATE = '2026-09-20';

let testCustomers: any[] = [];

async function createTestCustomer(overrides: any = {}) {
  const name = `MatrixTest_${SUFFIX}_${testCustomers.length}`;
  const { data } = await sb.from('customers').insert({
    name,
    phone: `0300999999${SUFFIX}${String(testCustomers.length).padStart(3, '0')}`,
    outstanding_balance: overrides.outstandingBalance ?? 5000,
    due_date: overrides.dueDate ?? null,
    is_active: true,
    created_at: new Date().toISOString(),
    ...overrides.customerExtra,
  }).select('*').single();
  const c: any = data;
  testCustomers.push(c);
  console.log(`  Customer[${testCustomers.length-1}]: ${c.name} | OB: ${c.outstanding_balance} | Due: ${c.due_date}`);
  return c;
}

async function createCreditSale(customerId: string, amount: number, createdDate: string) {
  const { data } = await sb.from('sales').insert({
    sale_number: `MTX-${SUFFIX}-${Date.now()}`,
    customer_id: customerId,
    subtotal: amount,
    total_amount: amount,
    amount_paid: 0,
    outstanding_balance: amount,
    payment_type: 'credit',
    is_voided: false,
    created_at: new Date(createdDate + 'T10:00:00+05:00').toISOString(),
  }).select('*').single();
  return data;
}

async function createConfig(customerId: string, config: any) {
  const { data } = await saveReminderConfig(customerId, {
    id: '',
    enabled: true,
    startDays: config.startDays,
    anchor: config.anchor,
    repeat: config.repeat,
    intervalN: config.intervalN ?? 7,
    intervalUnit: config.intervalUnit ?? 'days',
    escalation: config.escalation ?? [{ label: 'Gentle', tone: 'gentle', day: 1 }],
    ends: config.ends,
    endsDate: config.endsDate ?? null,
    endsCount: config.endsCount ?? 5,
    groupId: null,
    groupName: null,
  });
  return data;
}

async function loadAllCustomers() {
  const { data } = await sb.from('customers').select('*').order('created_at');
  return data || [];
}

async function loadAllSales() {
  const { data } = await sb.from('sales').select('*').order('created_at', { ascending: false });
  return data || [];
}

async function runEngine(customers?: any[], sales?: any[]) {
  const c = customers ?? await loadAllCustomers();
  const s = sales ?? await loadAllSales();
  return await generateReminders({ customers: c, sales: s, t: (k) => k });
}

async function getOccurrencesForConfig(configId: string) {
  const { data } = await sb.from('reminder_occurrences')
    .select('*')
    .eq('config_id', configId)
    .order('occurrence_number');
  return data || [];
}

async function clearTestData() {
  console.log('\n=== Cleaning test data ===');
  for (const c of testCustomers) {
    await sb.from('reminder_configs').delete().eq('customer_id', c.id);
    await sb.from('customers').delete().eq('id', c.id);
  }
  testCustomers = [];
  const { count: cCount } = await sb.from('customers').select('*', { count: 'exact', head: true });
  const { count: cfgCount } = await sb.from('reminder_configs').select('*', { count: 'exact', head: true });
  const { count: occCount } = await sb.from('reminder_occurrences').select('*', { count: 'exact', head: true });
  const { count: logCount } = await sb.from('reminder_logs').select('*', { count: 'exact', head: true });
  console.log(`  customers: ${cCount}, configs: ${cfgCount}, occurrences: ${occCount}, logs: ${logCount}`);
}

async function main() {
  console.log(`=== 36-Combination Reminder Engine Test ===`);
  console.log(`Suffix: ${SUFFIX} | Today (PK): ${TODAY}`);

  // Smoke test
  console.log('\n=== SMOKE TEST ===');
  const smokeCust = await createTestCustomer({ outstandingBalance: 5000, dueDate: FUTURE_DATE });
  const smokeConfig = await createConfig(smokeCust.id, { anchor: 'after_due', startDays: 0, repeat: 'once', ends: 'paid' });
  const smokeResult = await runEngine();
  console.log(`Smoke: ${smokeResult.length} reminders generated`);
  smokeResult.forEach(r => console.log(`  ${r.customerName} | ${r.trigger} | ${r._occurrenceStatus} | ${r.triggerDate.slice(0,10)}`));
  
  const smokeOccs = await getOccurrencesForConfig(smokeConfig.id);
  console.log(`Smoke occurrences persisted: ${smokeOccs.length}`);
  smokeOccs.forEach(o => console.log(`  ${o.id.slice(0,8)} | status: ${o.status} | date: ${o.scheduled_date} | key: ${o.occurrence_key}`));

  const smokeResult2 = await runEngine();
  console.log(`Smoke run 2: ${smokeResult2.length} reminders`);
  const smokeOccs2 = await getOccurrencesForConfig(smokeConfig.id);
  console.log(`Smoke occurrences after 2nd run: ${smokeOccs2.length} (should still be 1)`);

  // 36 combinations
  const results: any[] = [];
  let comboIndex = 0;
  const TRIGGERS = ['after_credit', 'after_due', 'before_due', 'before_harvest'];
  const REPEATS = ['once', 'interval', 'escalate'];
  const ENDS = ['paid', 'date', 'count'];

  for (const trigger of TRIGGERS) {
    for (const repeat of REPEATS) {
      for (const end of ENDS) {
        comboIndex++;
        console.log(`\n=== Combo ${comboIndex}/36: ${trigger} | ${repeat} | ${end} ===`);
        
        const testCust = await createTestCustomer({
          outstandingBalance: trigger === 'before_harvest' ? 3000 : 5000,
          dueDate: (trigger === 'after_due' || trigger === 'before_due') ? FUTURE_DATE : null,
        });

        let creditSale: any = null;
        if (trigger === 'after_credit') {
          creditSale = await createCreditSale(testCust.id, 5000, TODAY);
          console.log(`  Credit sale: ${creditSale.id.slice(0,8)} | date: ${creditSale.created_at.slice(0,10)} | amt: ${creditSale.total_amount}`);
        }
        if (trigger === 'before_harvest') {
          await saveCustomerCrops(testCust.id, ['Cotton']);
          const crops = await loadCustomerCrops(testCust.id);
          console.log(`  Crops: ${crops.join(', ') || 'none'}`);
        }

        const configArgs: any = { anchor: trigger, startDays: 3, repeat, ends: end };
        if (repeat === 'interval') configArgs.intervalN = 7;
        if (repeat === 'escalate') configArgs.escalation = [
          { label: 'Gentle', tone: 'gentle', day: 5 },
          { label: 'Hard', tone: 'firmer', day: 2 },
          { label: 'Extreme', tone: 'final', day: 1 },
        ];
        if (end === 'date') configArgs.endsDate = '2026-09-30';
        if (end === 'count') configArgs.endsCount = 3;

        const config = await createConfig(testCust.id, configArgs);
        console.log(`  Config: ${config.id.slice(0,8)} | ${trigger} | ${repeat} | ends=${end}`);

        const engineResult = await runEngine();
        const matching = engineResult.filter(r => r.configId === config.id);
        const occurrences = await getOccurrencesForConfig(config.id);

        console.log(`  Engine reminders: ${matching.length} | Persisted occurrences: ${occurrences.length}`);
        matching.forEach(r => {
          const occ = occurrences.find(o => o.id === r._occurrenceId);
          console.log(`    ${r.customerName} | status=${r._occurrenceStatus} | tone=${r.tone} | sched=${r.triggerDate.slice(0,10)} | key=${r._occurrenceKey}`);
          if (occ) console.log(`    DB: status=${occ.status} | date=${occ.scheduled_date} | num=${occ.occurrence_number} | stage=${occ.stage||'null'} | crop=${occ.crop_name||'null'}`);
        });

        // Idempotency
        const engineResult2 = await runEngine();
        const matching2 = engineResult2.filter(r => r.configId === config.id);
        const occurrences2 = await getOccurrencesForConfig(config.id);
        const idempotent = occurrences2.length === occurrences.length;
        console.log(`  Idempotent: run2=${matching2.length} occs=${occurrences2.length} → ${idempotent ? 'PASS' : 'FAIL'}`);

        // Lifecycle
        let lifecyclePass: boolean | null = null;
        if (end === 'paid' && trigger !== 'before_harvest') {
          await sb.from('customers').update({ outstanding_balance: 0 }).eq('id', testCust.id);
          if (creditSale) await sb.from('sales').update({ outstanding_balance: 0, amount_paid: creditSale.total_amount }).eq('id', creditSale.id);
          const occsAfter = await getOccurrencesForConfig(config.id);
          const futureScheduled = occsAfter.filter(o => o.status === 'scheduled').length;
          lifecyclePass = futureScheduled === 0;
          console.log(`  Lifecycle(paid): future scheduled=${futureScheduled} → ${lifecyclePass ? 'PASS' : 'FAIL'}`);
        }
        if (end === 'date') {
          const pastEnd = occurrences.filter(o => o.scheduled_date > (configArgs.endsDate || '2026-09-30'));
          lifecyclePass = pastEnd.length === 0;
          console.log(`  Lifecycle(date): past end=${pastEnd.length} → ${lifecyclePass ? 'PASS' : 'FAIL'}`);
        }
        if (end === 'count') {
          const fulfilled = occurrences.filter(o => o.status === 'due' || o.status === 'sent' || o.status === 'completed').length;
          lifecyclePass = fulfilled <= (configArgs.endsCount || 3);
          console.log(`  Lifecycle(count): fulfilled=${fulfilled}, limit=${configArgs.endsCount} → ${lifecyclePass ? 'PASS' : 'CHECK'}`);
        }

        results.push({ n: comboIndex, trigger, repeat, end, reminders: matching.length, occurrences: occurrences.length, idempotent, lifecycle: lifecyclePass });
      }
    }
  }

  // Summary
  console.log('\n\n=== 36-COMBINATION MATRIX ===');
  let pass = 0, fail = 0, check = 0;
  for (const r of results) {
    const ok = r.occurrences > 0 && r.idempotent && (r.lifecycle !== false);
    if (r.occurrences === 0) {
      fail++; console.log(`#${r.n} ${r.trigger} | ${r.repeat} | ${r.end} | occ=0 | → FAIL (no occurrences generated)`);
    } else if (!r.idempotent) {
      fail++; console.log(`#${r.n} ${r.trigger} | ${r.repeat} | ${r.end} | occ=${r.occurrences} | idempotent=FAIL → FAIL`);
    } else if (r.lifecycle === false) {
      fail++; console.log(`#${r.n} ${r.trigger} | ${r.repeat} | ${r.end} | occ=${r.occurrences} | lifecycle=FAIL → FAIL`);
    } else {
      pass++; console.log(`#${r.n} ${r.trigger} | ${r.repeat} | ${r.end} | occ=${r.occurrences} | idempotent=PASS | lifecycle=${r.lifecycle ?? 'n/a'} → PASS`);
    }
  }
  console.log(`\nPASS: ${pass} | FAIL: ${fail} | Total: ${results.length}`);

  await clearTestData();

  console.log('\n=== FINAL BASELINE ===');
  for (const t of ['customers', 'sales', 'reminder_configs', 'reminder_occurrences', 'reminder_logs', 'customer_crops']) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true });
    console.log(`${t}: ${count}`);
  }

  if (fail > 0) process.exit(1);
}

main().catch(e => { console.error('FATAL:', e.message); console.error(e.stack); process.exit(1); });
