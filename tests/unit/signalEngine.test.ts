/**
 * Unit Tests: Signal Engine
 *
 * Tests real business rules, not implementation details.
 * Uses QA database data via direct imports.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { computeLiveSignals, type LiveSignal } from '../../src/lib/signalEngine';
import { setupAllFixtures, cleanupAll, QA_IDS, execSql } from '../setup/fixtures';
import { recordEvidence, printReport, clearEvidence } from '../setup/evidence';

// ─── Test Data ───────────────────────────────────────────────────────────

const mockCustomers = [
  {
    id: QA_IDS.customerA,
    name: 'QA Customer A',
    phone: '923001111111',
    address: '',
    outstandingBalance: 30000,
    dueDate: '2026-08-01', // past due
    totalPurchases: 80000,
    totalPaid: 50000,
    creditLimit: 50000,
    isArchived: false,
    createdAt: '2026-01-01',
  },
  {
    id: QA_IDS.customerB,
    name: 'QA Customer B',
    phone: '923002222222',
    address: '',
    outstandingBalance: 26000,
    dueDate: null,
    totalPurchases: 40000,
    totalPaid: 14000,
    creditLimit: 25000,
    isArchived: false,
    createdAt: '2026-01-01',
  },
  {
    id: QA_IDS.customerC,
    name: 'QA Customer C',
    phone: '923003333333',
    address: 'Test Address',
    outstandingBalance: 0,
    dueDate: null,
    totalPurchases: 15000,
    totalPaid: 15000,
    creditLimit: 10000,
    isArchived: false,
    createdAt: '2026-01-01',
  },
];

const mockProducts = [
  {
    id: QA_IDS.productA,
    name: 'QA Product A',
    company: 'Test Co',
    category: 'seed' as const,
    stockQty: 100,
    imageUrl: null,
    barcode: null,
    baseUnit: 'kg' as const,
    variants: [{
      id: QA_IDS.variantA,
      productId: QA_IDS.productA,
      name: '1kg',
      sellingPrice: 500,
      costPrice: 300,
      unitSize: 1,
      qtyStep: 1,
      lowStockThreshold: 10,
      expiryDate: undefined,
      stockQty: 100,
    }],
  },
  {
    id: QA_IDS.productB,
    name: 'QA Product B',
    company: 'Test Co',
    category: 'fertilizer' as const,
    stockQty: 0,
    imageUrl: null,
    barcode: null,
    baseUnit: 'kg' as const,
    variants: [{
      id: QA_IDS.variantB,
      productId: QA_IDS.productB,
      name: '5kg',
      sellingPrice: 2000,
      costPrice: 1500,
      unitSize: 5,
      qtyStep: 1,
      lowStockThreshold: 5,
      expiryDate: undefined,
      stockQty: 0,
    }],
  },
];

const mockCompanies = [
  {
    id: QA_IDS.companyA,
    name: 'QA Supplier A',
    outstandingPayable: 15000,
    totalPurchases: 50000,
    dueDate: '2026-08-15', // past due
    createdAt: '2026-01-01',
  },
];

// ─── Tests ───────────────────────────────────────────────────────────────

describe('Signal Engine', () => {
  beforeAll(() => clearEvidence());
  afterAll(() => printReport());

  describe('Signal Generation', () => {
    it('should generate overdue credit signal for past-due customer', () => {
      const signals = computeLiveSignals({
        customers: mockCustomers,
        products: mockProducts,
        companies: mockCompanies,
        creditRequests: [],
      });

      const overdue = signals.filter(s => s.category === 'overdue_credit');
      expect(overdue.length).toBeGreaterThanOrEqual(1);

      const customerAOverdue = overdue.find(s => s.entity_id === QA_IDS.customerA);
      expect(customerAOverdue).toBeDefined();
      expect(customerAOverdue!.severity).toBe('critical');
      // The engine returns i18n keys, not English text; the UI resolves them.
      expect(customerAOverdue!.detailKey).toBe('signal.detailOverdue');
      expect(customerAOverdue!.detailParams!.amount).toContain('30,000');

      recordEvidence(
        'Overdue credit signal generated for past-due customer',
        'critical signal with Rs. 30,000 overdue',
        `severity=${customerAOverdue!.severity}, detailKey=${customerAOverdue!.detailKey}, amount=${customerAOverdue!.detailParams!.amount}`,
        'computeLiveSignals(mockData)',
        'PASS'
      );
    });

    it('should generate credit limit signal for customer exceeding limit', () => {
      const signals = computeLiveSignals({
        customers: mockCustomers,
        products: mockProducts,
        companies: mockCompanies,
        creditRequests: [],
      });

      const creditLimit = signals.filter(s => s.category === 'credit_limit');
      // Customer B has outstanding 26000 > creditLimit 25000
      const customerBCredit = creditLimit.find(s => s.entity_id === QA_IDS.customerB);
      expect(customerBCredit).toBeDefined();
      expect(customerBCredit!.severity).toBe('warning');

      recordEvidence(
        'Credit limit warning for customer exceeding limit',
        'warning signal for Customer B (26000 > 25000)',
        `severity=${customerBCredit!.severity}, detailKey=${customerBCredit!.detailKey}`,
        'computeLiveSignals(mockData)',
        'PASS'
      );
    });

    it('should generate out-of-stock signal for zero-stock product', () => {
      const signals = computeLiveSignals({
        customers: mockCustomers,
        products: mockProducts,
        companies: mockCompanies,
        creditRequests: [],
      });

      const outOfStock = signals.find(s => s.id === `out-of-stock-${QA_IDS.productB}`);
      expect(outOfStock).toBeDefined();
      expect(outOfStock!.severity).toBe('critical');
      expect(outOfStock!.title).toBe('QA Product B');

      recordEvidence(
        'Out-of-stock signal for zero-stock product',
        'critical signal for Product B',
        `severity=${outOfStock!.severity}, title=${outOfStock!.title}`,
        'computeLiveSignals(mockData)',
        'PASS'
      );
    });

    it('should generate supplier overdue signal', () => {
      const signals = computeLiveSignals({
        customers: mockCustomers,
        products: mockProducts,
        companies: mockCompanies,
        creditRequests: [],
      });

      const supplierOverdue = signals.find(s => s.id === `supplier-overdue-${QA_IDS.companyA}`);
      expect(supplierOverdue).toBeDefined();
      expect(supplierOverdue!.severity).toBe('critical');

      recordEvidence(
        'Supplier overdue signal for past-due supplier',
        'critical signal for Supplier A',
        `severity=${supplierOverdue!.severity}`,
        'computeLiveSignals(mockData)',
        'PASS'
      );
    });

    it('should NOT generate signals for healthy customer', () => {
      const signals = computeLiveSignals({
        customers: mockCustomers,
        products: mockProducts,
        companies: mockCompanies,
        creditRequests: [],
      });

      // Customer C: no outstanding, within limit
      const customerCSignals = signals.filter(s => s.entity_id === QA_IDS.customerC);
      expect(customerCSignals.length).toBe(0);

      recordEvidence(
        'No signals for healthy customer (no outstanding)',
        '0 signals for Customer C',
        `${customerCSignals.length} signals`,
        'computeLiveSignals(mockData)',
        'PASS'
      );
    });

    it('should generate credit request signal for pending request', () => {
      const signals = computeLiveSignals({
        customers: mockCustomers,
        products: mockProducts,
        companies: mockCompanies,
        creditRequests: [{
          id: 'test-cr-001',
          customerId: QA_IDS.customerC,
          customerName: 'QA Customer C',
          currentLimit: 10000,
          requestedLimit: 30000,
        }],
      });

      const creditRequest = signals.find(s => s.id === 'credit-request-test-cr-001');
      expect(creditRequest).toBeDefined();
      expect(creditRequest!.severity).toBe('critical');
      expect(creditRequest!.signalAction).toBe('approve_reject');

      recordEvidence(
        'Credit request signal for pending request',
        'critical signal with approve_reject action',
        `severity=${creditRequest!.severity}, action=${creditRequest!.signalAction}`,
        'computeLiveSignals(mockData)',
        'PASS'
      );
    });
  });

  describe('Priority Sorting', () => {
    it('should sort critical signals before warning signals', () => {
      const signals = computeLiveSignals({
        customers: mockCustomers,
        products: mockProducts,
        companies: mockCompanies,
        creditRequests: [],
      });

      const firstCritical = signals.findIndex(s => s.severity === 'critical');
      const firstWarning = signals.findIndex(s => s.severity === 'warning');

      if (firstWarning >= 0) {
        expect(firstCritical).toBeLessThan(firstWarning);
      }

      recordEvidence(
        'Critical signals sorted before warning signals',
        `firstCritical (${firstCritical}) < firstWarning (${firstWarning})`,
        `firstCritical=${firstCritical}, firstWarning=${firstWarning}`,
        'computeLiveSignals sorting',
        firstWarning < 0 || firstCritical < firstWarning ? 'PASS' : 'FAIL'
      );
    });

    it('should sort within severity by priority (highest first)', () => {
      const signals = computeLiveSignals({
        customers: mockCustomers,
        products: mockProducts,
        companies: mockCompanies,
        creditRequests: [{
          id: 'test-cr-high',
          customerId: QA_IDS.customerC,
          customerName: 'QA Customer C',
          currentLimit: 10000,
          requestedLimit: 50000,
        }],
      });

      const criticals = signals.filter(s => s.severity === 'critical');
      // Credit request (priority 85) should come before out-of-stock (priority 70)
      const creditReqIdx = criticals.findIndex(s => s.id === 'credit-request-test-cr-high');
      const outOfStockIdx = criticals.findIndex(s => s.id === `out-of-stock-${QA_IDS.productB}`);

      if (creditReqIdx >= 0 && outOfStockIdx >= 0) {
        expect(creditReqIdx).toBeLessThan(outOfStockIdx);
      }

      recordEvidence(
        'Within critical: credit request (85) before out-of-stock (70)',
        `creditReqIdx < outOfStockIdx`,
        `creditReqIdx=${creditReqIdx}, outOfStockIdx=${outOfStockIdx}`,
        'computeLiveSignals sorting',
        outOfStockIdx < 0 || creditReqIdx < outOfStockIdx ? 'PASS' : 'FAIL'
      );
    });
  });

  describe('Signal Resolution', () => {
    it('should not generate overdue signal when due date is in future', () => {
      const futureCustomer = [{
        ...mockCustomers[0],
        dueDate: '2099-12-31',
      }];

      const signals = computeLiveSignals({
        customers: futureCustomer,
        products: [],
        companies: [],
        creditRequests: [],
      });

      const overdue = signals.filter(s => s.category === 'overdue_credit');
      expect(overdue.length).toBe(0);

      recordEvidence(
        'No overdue signal when due date is in the future',
        '0 overdue signals',
        `${overdue.length} signals`,
        'computeLiveSignals',
        'PASS'
      );
    });

    it('should not generate credit limit signal when within limit', () => {
      const withinLimit = [{
        ...mockCustomers[1],
        outstandingBalance: 20000, // below 25000 limit
      }];

      const signals = computeLiveSignals({
        customers: withinLimit,
        products: [],
        companies: [],
        creditRequests: [],
      });

      const creditLimit = signals.filter(s => s.category === 'credit_limit');
      expect(creditLimit.length).toBe(0);

      recordEvidence(
        'No credit limit signal when within limit',
        '0 credit limit signals',
        `${creditLimit.length} signals`,
        'computeLiveSignals',
        'PASS'
      );
    });
  });
});
