const C = require('../src/core.js');
const assert = require('assert');
const today = '2026-11-09';
const s = C.blankState();
s.bank = { amount: 50000, asOf: '2026-11-05' };
s.income = { salary: 67000, payday: 1, sources: [] };
s.fixed = [{ id: 'r', name: 'Rent', category: 'Rent', amount: 15000, dueDay: 10 }];
s.loans = [{ id: 'l', lender: 'Bajaj', emi: 9519, remainingEmis: 10, nextDate: '2026-11-15', outstanding: 90000 }];
s.cards = [{ id: 'c', bank: 'HDFC', limit: 100000, outstanding: 12000, asOf: '2026-11-05', dueDay: 20, totalDue: 0 }];
s.savingsTarget = { monthly: 10000 }; s.cushion = 2000;
s.budgets = { 'Food & Dining': 5000 };
const txs = [
  { id: '1', type: 'expense', amount: 4000, name: 'Swiggy', category: 'Food & Dining', date: '2026-11-06', method: 'HDFC Credit Card', cardId: 'c' },
  { id: '2', type: 'expense', amount: 1000, name: 'Zomato', category: 'Food & Dining', date: '2026-11-07', method: 'UPI', othersOwe: 400 },
  { id: '3', type: 'expense', amount: 5000, name: 'HDFC bill', category: 'Credit Card Payments', date: '2026-11-08', method: 'Bank Transfer', cardId: 'c' },
];
// Card: 12000 + 4000 - 5000
assert.strictEqual(C.cardOutstanding(s.cards[0], txs), 11000);
// Bank: 50000 - 1000 (UPI) - 5000 (bill); card purchase not from bank
assert.strictEqual(C.bankBalance(s, txs), 44000);
// Spend excludes card bill and others' share: 4000 + 600
assert.strictEqual(C.monthSummary(txs, '2026-11').spend, 4600);
const st = C.safeToSpend(s, txs, today);
assert.strictEqual(st.payday, '2026-12-01');
// obligations: rent 15000 + EMI 9519 + card 11000 = 35519; savings 10000; cushion 2000
assert.strictEqual(st.due, 35519);
assert.strictEqual(st.safe, 44000 - 35519 - 10000 - 2000 < 0 ? 0 : 44000 - 35519 - 10000 - 2000);
assert.strictEqual(st.shortfall, 3519);
const b = C.budgetStatus(s, txs, '2026-11');
assert.strictEqual(b.rows[0].spent, 4600); assert.strictEqual(b.rows[0].level, 90);
assert.strictEqual(C.parseAmount('Can I spend ₹8,000 on shoes?'), 8000);
assert.strictEqual(C.parseAmount('a 15k phone'), 15000);
assert.strictEqual(C.parseAmount('car for 6.5 lakh'), 650000);
assert.strictEqual(C.nextOnDay('2026-01-31', 30), '2026-02-28');
assert.ok(C.findDuplicate(txs, { type: 'expense', amount: 1000, name: ' zomato', date: '2026-11-07' }));
// rent paid -> drops out
txs.push({ id: '4', type: 'expense', amount: 15000, name: 'Rent', category: 'Rent', date: '2026-11-09', method: 'Bank Transfer' });
assert.strictEqual(C.safeToSpend(s, txs, today).due, 20519);
console.log('core ok', C.fmt(123456.4), C.fmtShort(350000), C.insights(s, txs, today).length);
// same-day tie-break
const s2 = C.blankState(); s2.bank = { amount: 1000, asOf: '2026-11-09', asOfTs: 100 };
assert.strictEqual(C.bankBalance(s2, [{ type: 'expense', amount: 200, date: '2026-11-09', method: 'UPI', createdAt: 50 }, { type: 'expense', amount: 300, date: '2026-11-09', method: 'UPI', createdAt: 150 }]), 700);
console.log('tie ok');
