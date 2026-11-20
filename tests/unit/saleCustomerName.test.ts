import { describe, expect, it } from 'vitest';
import { customerNamesById, saleCustomerName } from '../../src/lib/saleCustomerName';

/**
 * A sale shows its customer's current name.
 *
 * The bug this exists for: `sales.customer_name_snapshot` is written once, when the bill is made.
 * Renaming "Perm Customer A" to "Perm Customer B" left every existing bill in the Sales list
 * showing the old name while the customer record showed the new one — the same person, two names,
 * on one screen.
 */
describe('a sale shows the live customer name', () => {
  const names = customerNamesById([
    { id: 'c1', name: 'Perm Customer B' },
    { id: 'c2', name: '   ' }, // a blank name is not an answer
  ]);

  it('prefers the current name over the one the bill recorded', () => {
    expect(saleCustomerName({ customerId: 'c1', customerName: 'Perm Customer A' }, names)).toBe(
      'Perm Customer B',
    );
  });

  it('keeps the snapshot for a walk-in, a deleted customer, or a blank name', () => {
    // No customer id: a walk-in, and the snapshot is the only truth there is.
    expect(saleCustomerName({ customerId: '', customerName: 'Walk-in' }, names)).toBe('Walk-in');
    // An id the list no longer holds (deleted customer): the bill's own name stands.
    expect(saleCustomerName({ customerId: 'gone', customerName: 'Perm Customer A' }, names)).toBe(
      'Perm Customer A',
    );
    // A name cleared to whitespace must not blank the row.
    expect(saleCustomerName({ customerId: 'c2', customerName: 'Perm Customer A' }, names)).toBe(
      'Perm Customer A',
    );
  });

  it('builds one map, and drops entries that could never be shown', () => {
    expect(names.size).toBe(1);
    expect(names.get('c1')).toBe('Perm Customer B');
  });
});
