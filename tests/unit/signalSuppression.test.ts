/**
 * Unit Tests: Signal Suppression
 *
 * Tests suppression intervals, escalation logic, and localStorage persistence.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  markSignalReviewed,
  isSignalSuppressed,
  getSuppressionInterval,
  isSignalEscalated,
  clearAllSuppressions,
} from '../../src/lib/signalSuppression';
import type { LiveSignal } from '../../src/lib/signalEngine';
import { recordEvidence, printReport, clearEvidence } from '../setup/evidence';

// ─── Mock Signals ────────────────────────────────────────────────────────

function makeSignal(overrides: Partial<LiveSignal> = {}): LiveSignal {
  return {
    id: 'test-signal-1',
    category: 'credit_limit',
    severity: 'warning',
    priority: 50,
    entity_type: 'customer',
    entity_id: 'cust-1',
    entity_name: 'Test Customer',
    title: 'Test Customer',
    detail: 'Rs. 30,000 of Rs. 25,000 limit (120%)',
    created_at: new Date().toISOString(),
    value: 30000,
    threshold: 25000,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('Signal Suppression', () => {
  beforeEach(() => {
    clearAllSuppressions();
  });

  describe('Suppression Intervals', () => {
    it('should return 0 for critical (never suppressed)', () => {
      expect(getSuppressionInterval('critical')).toBe(0);
      recordEvidence('Critical signals never suppressed', 'interval = 0', `interval = ${getSuppressionInterval('critical')}`, 'getSuppressionInterval', 'PASS');
    });

    it('should return 3 for warning (3-day suppression)', () => {
      expect(getSuppressionInterval('warning')).toBe(3);
      recordEvidence('Warning signals suppressed for 3 days', 'interval = 3', `interval = ${getSuppressionInterval('warning')}`, 'getSuppressionInterval', 'PASS');
    });

    it('should return 7 for info (7-day suppression)', () => {
      expect(getSuppressionInterval('info')).toBe(7);
      recordEvidence('Info signals suppressed for 7 days', 'interval = 7', `interval = ${getSuppressionInterval('info')}`, 'getSuppressionInterval', 'PASS');
    });
  });

  describe('Mark Reviewed + Check Suppression', () => {
    it('should suppress a warning signal after review', () => {
      const signal = makeSignal();
      markSignalReviewed(signal);

      expect(isSignalSuppressed(signal.id, 3)).toBe(true);
      recordEvidence('Warning signal suppressed after review', 'isSignalSuppressed = true', 'isSignalSuppressed = true', 'markSignalReviewed + isSignalSuppressed', 'PASS');
    });

    it('should NOT suppress a critical signal (interval = 0)', () => {
      const signal = makeSignal({ severity: 'critical' });
      markSignalReviewed(signal);

      expect(isSignalSuppressed(signal.id, 0)).toBe(false);
      recordEvidence('Critical signal not suppressed (interval=0)', 'isSignalSuppressed = false', 'isSignalSuppressed = false', 'isSignalSuppressed(id, 0)', 'PASS');
    });

    it('should NOT suppress an unreviewed signal', () => {
      expect(isSignalSuppressed('unreviewed-id', 3)).toBe(false);
      recordEvidence('Unreviewed signal not suppressed', 'isSignalSuppressed = false', 'isSignalSuppressed = false', 'isSignalSuppressed(unreviewed, 3)', 'PASS');
    });
  });

  describe('Escalation', () => {
    it('should detect credit_limit escalation when usage increases >= 25%', () => {
      const signal = makeSignal({ value: 37500, threshold: 25000 }); // 150% usage
      markSignalReviewed({ ...signal, value: 30000 }); // reviewed at 120%

      expect(isSignalEscalated(signal)).toBe(true);
      recordEvidence('Credit limit escalation detected (120% -> 150%)', 'isSignalEscalated = true', 'isSignalEscalated = true', 'isSignalEscalated', 'PASS');
    });

    it('should NOT detect escalation for small increase', () => {
      const signal = makeSignal({ value: 28000, threshold: 25000 }); // 112%
      markSignalReviewed({ ...signal, value: 26000 }); // reviewed at 104%

      expect(isSignalEscalated(signal)).toBe(false);
      recordEvidence('No escalation for small increase (104% -> 112%)', 'isSignalEscalated = false', 'isSignalEscalated = false', 'isSignalEscalated', 'PASS');
    });

    it('should detect supplier_payable escalation when amount increases >= 25%', () => {
      const signal = makeSignal({
        category: 'supplier_payable',
        value: 18750, // 25% increase from 15000
        threshold: undefined,
      });
      markSignalReviewed({ ...signal, value: 15000 });

      expect(isSignalEscalated(signal)).toBe(true);
      recordEvidence('Supplier payable escalation detected (15000 -> 18750)', 'isSignalEscalated = true', 'isSignalEscalated = true', 'isSignalEscalated', 'PASS');
    });

    it('should return false for no review record', () => {
      const signal = makeSignal({ value: 50000, threshold: 25000 });
      expect(isSignalEscalated(signal)).toBe(false);
      recordEvidence('No escalation without review record', 'isSignalEscalated = false', 'isSignalEscalated = false', 'isSignalEscalated (no record)', 'PASS');
    });
  });

  describe('Cleanup', () => {
    it('should clear all suppressions', () => {
      const signal = makeSignal();
      markSignalReviewed(signal);
      expect(isSignalSuppressed(signal.id, 3)).toBe(true);

      clearAllSuppressions();
      expect(isSignalSuppressed(signal.id, 3)).toBe(false);
      recordEvidence('Clear all suppressions works', 'isSignalSuppressed = false after clear', 'isSignalSuppressed = false', 'clearAllSuppressions', 'PASS');
    });
  });
});
