/**
 * Signal Suppression
 *
 * Temporary suppression of Action Center signals after admin review.
 * Uses localStorage for device-local persistence (same pattern as
 * localCache.ts, deviceSession.ts, localGroupRegistry.ts).
 *
 * The Signal Engine remains the source of truth for whether a business
 * condition exists. Suppression only answers:
 * "Should this currently existing signal be shown right now?"
 */

import type { LiveSignal, SignalSeverity } from "@/lib/signalEngine";

// ─── Storage ────────────────────────────────────────────────────────────────

const STORAGE_KEY = "agrishop_signal_suppression";

interface SuppressedSignal {
  reviewedAt: number;       // epoch ms when admin clicked "Reviewed"
  value?: number;           // signal value at time of review (for escalation)
  threshold?: number;       // signal threshold at time of review (for escalation)
  days?: number;            // signal days at time of review (for escalation)
}

type SuppressionStore = Record<string, SuppressedSignal>;

function readStore(): SuppressionStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as SuppressionStore;
  } catch {
    return {};
  }
}

function writeStore(store: SuppressionStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // localStorage full or unavailable — fail silently
  }
}

// ─── Suppression Intervals ──────────────────────────────────────────────────

/** Returns suppression interval in days for a given severity. */
export function getSuppressionInterval(severity: SignalSeverity): number {
  switch (severity) {
    case "critical": return 0;   // never suppressed
    case "warning":  return 3;
    case "info":     return 7;
    default:         return 0;
  }
}

// ─── Core Functions ─────────────────────────────────────────────────────────

/**
 * Mark a signal as reviewed. Stores the review timestamp and the signal's
 * current values (for escalation comparison).
 */
export function markSignalReviewed(signal: LiveSignal): void {
  const store = readStore();
  store[signal.id] = {
    reviewedAt: Date.now(),
    value: signal.value,
    threshold: signal.threshold,
    days: signal.days,
  };
  writeStore(store);
}

/**
 * Check whether a signal is currently suppressed.
 * Returns false if: no review record, interval expired, or interval is 0.
 */
export function isSignalSuppressed(signalId: string, intervalDays: number): boolean {
  if (intervalDays <= 0) return false;
  const store = readStore();
  const record = store[signalId];
  if (!record) return false;
  const elapsed = Date.now() - record.reviewedAt;
  const intervalMs = intervalDays * 24 * 60 * 60 * 1000;
  return elapsed < intervalMs;
}

/**
 * Get the review record for a signal (for escalation comparison).
 * Returns null if not reviewed.
 */
export function getReviewRecord(signalId: string): SuppressedSignal | null {
  const store = readStore();
  return store[signalId] ?? null;
}

/**
 * Check whether a signal's business condition has materially escalated
 * compared with when it was reviewed.
 *
 * Returns true if escalation is detected (signal should reappear immediately).
 * Returns false if no escalation or no review record exists.
 */
export function isSignalEscalated(signal: LiveSignal): boolean {
  const record = getReviewRecord(signal.id);
  if (!record) return false;

  switch (signal.category) {
    case "credit_limit": {
      // Escalation: current usage increased by ≥25% compared to reviewed state
      if (record.value == null || record.threshold == null || record.threshold === 0) return false;
      const reviewedUsage = record.value / record.threshold;
      const currentUsage = (signal.value ?? 0) / (signal.threshold ?? 1);
      const increase = currentUsage - reviewedUsage;
      return increase >= 0.25;
    }

    case "low_stock": {
      // Escalation: stock dropped to ≤50% of the product's low-stock threshold
      if (record.value == null || signal.threshold == null || signal.threshold === 0) return false;
      const halfThreshold = signal.threshold * 0.5;
      return (signal.value ?? 0) <= halfThreshold;
    }

    case "expiry_approaching": {
      // Escalation: remaining days dropped to ≤7
      if (signal.days == null) return false;
      return signal.days <= 7;
    }

    case "supplier_payable": {
      // Escalation: payable amount increased by ≥25% compared to reviewed state
      if (record.value == null || record.value === 0) return false;
      const increase = ((signal.value ?? 0) - record.value) / record.value;
      return increase >= 0.25;
    }

    default:
      return false;
  }
}

/**
 * Clean up old suppression records that are no longer needed.
 * Removes records older than 30 days to prevent unbounded growth.
 */
export function cleanupOldRecords(): void {
  const store = readStore();
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  let changed = false;
  for (const [key, record] of Object.entries(store)) {
    if (record.reviewedAt < cutoff) {
      delete store[key];
      changed = true;
    }
  }
  if (changed) writeStore(store);
}

/**
 * Clear all suppression records (for QA cleanup).
 */
export function clearAllSuppressions(): void {
  localStorage.removeItem(STORAGE_KEY);
}
