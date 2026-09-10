/**
 * QA Evidence Collector
 *
 * Every test captures structured evidence:
 * expected, actual, source, environment, timestamp, PASS/FAIL.
 */

export interface Evidence {
  test: string;
  expected: string;
  actual: string;
  source: string;
  environment: string;
  timestamp: string;
  result: 'PASS' | 'FAIL' | 'WARNING' | 'UNTESTABLE';
  details?: string;
}

const evidence: Evidence[] = [];

export function recordEvidence(
  test: string,
  expected: string,
  actual: string,
  source: string,
  result: Evidence['result'],
  details?: string
) {
  const entry: Evidence = {
    test,
    expected,
    actual,
    source,
    environment: 'QA (bpybjrjenwccowvtrevu)',
    timestamp: new Date().toISOString(),
    result,
    details,
  };
  evidence.push(entry);
  const icon = result === 'PASS' ? '✅' : result === 'FAIL' ? '❌' : result === 'WARNING' ? '⚠️' : '⏭️';
  console.log(`  ${icon} ${test}: ${result}`);
  if (result === 'FAIL') {
    console.log(`     Expected: ${expected}`);
    console.log(`     Actual:   ${actual}`);
  }
  return entry;
}

export function getEvidence(): Evidence[] {
  return [...evidence];
}

export function getPassFailSummary() {
  const pass = evidence.filter(e => e.result === 'PASS').length;
  const fail = evidence.filter(e => e.result === 'FAIL').length;
  const warn = evidence.filter(e => e.result === 'WARNING').length;
  const skip = evidence.filter(e => e.result === 'UNTESTABLE').length;
  return { pass, fail, warn, skip, total: evidence.length };
}

export function printReport() {
  const summary = getPassFailSummary();
  console.log('\n' + '='.repeat(60));
  console.log('QA EVIDENCE REPORT');
  console.log('='.repeat(60));
  console.log(`Environment: QA Database (bpybjrjenwccowvtrevu)`);
  console.log(`Timestamp:   ${new Date().toISOString()}`);
  console.log(`Total:       ${summary.total}`);
  console.log(`PASS:        ${summary.pass}`);
  console.log(`FAIL:        ${summary.fail}`);
  console.log(`WARNING:     ${summary.warn}`);
  console.log(`UNTESTABLE:  ${summary.skip}`);
  console.log('='.repeat(60));

  if (summary.fail > 0) {
    console.log('\nFAILURES:');
    evidence.filter(e => e.result === 'FAIL').forEach(e => {
      console.log(`  ❌ ${e.test}`);
      console.log(`     Expected: ${e.expected}`);
      console.log(`     Actual:   ${e.actual}`);
      console.log(`     Source:   ${e.source}`);
    });
  }

  console.log('='.repeat(60));
  return summary;
}

export function clearEvidence() {
  evidence.length = 0;
}
