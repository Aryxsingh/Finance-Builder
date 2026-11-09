/* Finance OS — calculation core. Pure functions only (no DOM, no storage),
   so the same file runs in the page and under Node for tests. */
(function (root) {
  'use strict';

  const DEFAULT_CATEGORIES = [
    'Rent', 'Groceries', 'Food & Dining', 'Transportation', 'Shopping',
    'Entertainment', 'Bills & Utilities', 'Medical', 'Travel', 'EMIs',
    'Credit Card Payments', 'Investments', 'Subscriptions', 'Personal', 'Other',
  ];
  const INCOME_CATEGORIES = ['Salary', 'Freelance', 'Bonus', 'From friends', 'Reimbursement', 'Other income'];
  const METHODS = ['UPI', 'Cash', 'HDFC Credit Card', 'Other Credit Card', 'Bank Transfer', 'Other'];
  const CARD_METHODS = ['HDFC Credit Card', 'Other Credit Card'];
  // Categories that move money but are not consumption.
  const CARD_PAYMENT = 'Credit Card Payments';
  const INVESTMENT = 'Investments';
  const ASSET_TYPES = ['Bank savings', 'Emergency fund', 'Fixed deposit', 'Mutual funds', 'Stocks', 'Other investment'];

  // ---------- dates ----------
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parse = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
  const monthKey = (s) => String(s).slice(0, 7);
  const daysInMonth = (y, m0) => new Date(y, m0 + 1, 0).getDate();
  const addMonths = (s, n) => {
    const d = parse(s); const day = d.getDate();
    const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
    t.setDate(Math.min(day, daysInMonth(t.getFullYear(), t.getMonth())));
    return iso(t);
  };
  const shiftMonthKey = (mk, n) => addMonths(mk + '-01', n).slice(0, 7);
  const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
  /** The next date (>= today) falling on day-of-month `day`. */
  const nextOnDay = (today, day) => {
    const t = parse(today);
    const clamp = (y, m) => Math.min(day, daysInMonth(y, m));
    let d = new Date(t.getFullYear(), t.getMonth(), clamp(t.getFullYear(), t.getMonth()));
    if (d < t) { const y = t.getFullYear(), m = t.getMonth() + 1; d = new Date(y, m, clamp(y, m)); }
    return iso(d);
  };

  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const sum = (arr, f) => arr.reduce((a, x) => a + num(f ? f(x) : x), 0);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  // ---------- transaction semantics ----------
  const isCardMethod = (m) => CARD_METHODS.includes(m);
  /** Counts as spending: an expense that is not a card-bill payment or an investment. */
  const isSpend = (t) => t.type === 'expense' && t.category !== CARD_PAYMENT && t.category !== INVESTMENT;
  /** The part of a spend that is mine (shared bills: others' share is a receivable). */
  const myShare = (t) => Math.max(0, num(t.amount) - num(t.othersOwe));
  /** Cash leaving the bank account (card purchases leave later, via the bill payment). */
  const bankOut = (t) => t.type === 'expense' && !isCardMethod(t.method) ? num(t.amount) : 0;
  const bankIn = (t) => t.type === 'income' ? num(t.amount) : 0;

  /** Did `t` happen after a manual figure entered on `asOf` (ms timestamp `ts` breaks same-day ties)? */
  const isAfter = (t, asOf, ts) => t.date > asOf || (t.date === asOf && ts != null && (t.createdAt || 0) > ts);

  function monthTx(txs, mk) { return txs.filter((t) => monthKey(t.date) === mk); }

  function monthSummary(txs, mk) {
    const list = monthTx(txs, mk);
    const income = sum(list.filter((t) => t.type === 'income'), (t) => t.amount);
    const spend = sum(list.filter(isSpend), myShare);
    const invested = sum(list.filter((t) => t.type === 'expense' && t.category === INVESTMENT), (t) => t.amount);
    const cardPaid = sum(list.filter((t) => t.type === 'expense' && t.category === CARD_PAYMENT), (t) => t.amount);
    const net = income - spend;
    return { mk, income, spend, invested, cardPaid, net, savingsRate: income > 0 ? net / income : null, count: list.length };
  }

  function byKey(list, keyFn, valFn) {
    const m = new Map();
    for (const t of list) { const k = keyFn(t); m.set(k, (m.get(k) || 0) + valFn(t)); }
    return [...m.entries()].map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v);
  }

  // ---------- cards ----------
  /** Outstanding = balance entered at `asOf` + card purchases after it − bill payments after it. */
  function cardOutstanding(card, txs) {
    const after = txs.filter((t) => t.cardId === card.id && isAfter(t, card.asOf || '0000', card.asOfTs));
    const purchases = sum(after.filter((t) => t.type === 'expense' && t.category !== CARD_PAYMENT), (t) => t.amount);
    const refunds = sum(after.filter((t) => t.type === 'income'), (t) => t.amount);
    const paid = sum(after.filter((t) => t.type === 'expense' && t.category === CARD_PAYMENT), (t) => t.amount);
    return Math.max(0, num(card.outstanding) + purchases - refunds - paid);
  }

  // ---------- IOUs ----------
  const iouPaid = (x) => sum(x.payments || [], (p) => p.amount);
  const iouLeft = (x) => Math.max(0, num(x.amount) - iouPaid(x));
  const iouStatus = (x, today) => {
    const left = iouLeft(x);
    if (left <= 0) return 'Settled';
    if (iouPaid(x) > 0) return 'Partly paid';
    const due = x.expected || x.due;
    if (due && due < today) return 'Overdue';
    return 'Open';
  };

  // ---------- bank balance ----------
  /** Bank balance: the last manual figure, rolled forward by everything recorded after it. */
  function bankBalance(s, txs) {
    const asOf = s.bank && s.bank.asOf;
    if (!asOf || s.bank.amount === '' || s.bank.amount == null) return null;
    const after = txs.filter((t) => isAfter(t, asOf, s.bank.asOfTs));
    let bal = num(s.bank.amount) + sum(after, bankIn) - sum(after, bankOut);
    for (const x of s.lent || []) {
      if (!x.txId && x.date > asOf) bal -= num(x.amount);
      bal += sum((x.payments || []).filter((p) => p.date > asOf), (p) => p.amount);
    }
    for (const x of s.borrowed || []) {
      if (x.date && x.date > asOf) bal += num(x.amount);
      bal -= sum((x.payments || []).filter((p) => p.date > asOf), (p) => p.amount);
    }
    return bal;
  }

  // ---------- obligations ----------
  function nextPayday(s, today) { return nextOnDay(today, num(s.income && s.income.payday) || 1); }

  /** Was a fixed bill already paid this month? Match by category or name, ±15% amount. */
  function fixedPaid(f, txs, mk) {
    return monthTx(txs, mk).some((t) => t.type === 'expense' &&
      (t.fixedId === f.id || ((t.category === f.category || (t.name || '').toLowerCase() === (f.name || '').toLowerCase()) &&
        Math.abs(num(t.amount) - num(f.amount)) <= num(f.amount) * 0.15)));
  }

  /** Everything that must be paid from now until (and excluding) `until`. */
  function obligations(s, txs, today, until) {
    const out = [];
    const mk = monthKey(today);
    for (const f of s.fixed || []) {
      if (!num(f.amount)) continue;
      const due = nextOnDay(today, num(f.dueDay) || 1);
      const dueThisMonth = monthKey(due) === mk;
      if (dueThisMonth && fixedPaid(f, txs, mk)) continue;
      if (due < until) out.push({ kind: 'Bill', name: f.name, amount: num(f.amount), date: due });
    }
    for (const l of s.loans || []) {
      if (!num(l.emi) || num(l.remainingEmis) <= 0 || !l.nextDate) continue;
      if (l.nextDate < until) out.push({ kind: 'EMI', name: l.lender, amount: num(l.emi), date: l.nextDate < today ? today : l.nextDate, overdue: l.nextDate < today });
    }
    for (const c of s.cards || []) {
      const owed = cardOutstanding(c, txs);
      if (owed <= 0 || !num(c.dueDay)) continue;
      const due = nextOnDay(today, num(c.dueDay));
      // Statement amount if entered, otherwise everything outstanding (conservative).
      const amt = Math.min(owed, num(c.totalDue) > 0 ? num(c.totalDue) : owed);
      if (due < until) out.push({ kind: 'Card', name: c.bank, amount: amt, date: due, minDue: num(c.minDue) });
    }
    for (const p of s.planned || []) {
      if (!p.done && p.date >= today && p.date < until) out.push({ kind: 'Planned', name: p.name, amount: num(p.amount), date: p.date });
    }
    for (const b of s.borrowed || []) {
      const left = iouLeft(b);
      if (left > 0 && b.due && b.due < until) out.push({ kind: 'Owe', name: b.person, amount: left, date: b.due < today ? today : b.due });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Money still to set aside this month to meet the monthly savings target. */
  function savingsStillToSet(s, txs, today) {
    const target = num(s.savingsTarget && s.savingsTarget.monthly);
    if (!target) return 0;
    const done = monthSummary(txs, monthKey(today)).invested;
    return Math.max(0, target - done);
  }

  /**
   * SAFE TO SPEND: bank balance until next payday, after every bill, EMI, card
   * due, planned expense and debt falling before payday, the rest of this
   * month's savings target, and a small cushion. Never negative.
   */
  function safeToSpend(s, txs, today) {
    const bank = bankBalance(s, txs);
    const payday = nextPayday(s, today);
    const obs = obligations(s, txs, today, payday === today ? addMonths(today, 1) : payday);
    const due = sum(obs, (o) => o.amount);
    const savings = savingsStillToSet(s, txs, today);
    const cushion = num(s.cushion);
    const missing = [];
    if (bank == null) missing.push('current bank balance');
    if (!num(s.income && s.income.salary)) missing.push('monthly salary');
    const raw = bank == null ? null : bank - due - savings - cushion;
    const days = Math.max(1, daysBetween(today, payday) || daysInMonth(parse(today).getFullYear(), parse(today).getMonth()));
    return {
      bank, payday, obligations: obs, due, savings, cushion, missing,
      safe: raw == null ? null : Math.max(0, raw), shortfall: raw != null && raw < 0 ? -raw : 0,
      perDay: raw == null ? null : Math.max(0, raw) / days, days,
    };
  }

  // ---------- budgets ----------
  function budgetStatus(s, txs, mk) {
    const spent = new Map(byKey(monthTx(txs, mk).filter(isSpend), (t) => t.category, myShare).map((x) => [x.k, x.v]));
    const rows = Object.entries(s.budgets || {}).filter(([, v]) => num(v) > 0).map(([cat, v]) => {
      const used = spent.get(cat) || 0; const pct = used / num(v);
      return { cat, budget: num(v), spent: used, left: num(v) - used, pct, level: pct >= 1 ? 100 : pct >= 0.9 ? 90 : pct >= 0.75 ? 75 : 0 };
    }).sort((a, b) => b.pct - a.pct);
    const total = sum(rows, (r) => r.budget);
    const used = sum(rows, (r) => r.spent);
    const unbudgeted = [...spent.entries()].filter(([c]) => !(num((s.budgets || {})[c]) > 0)).map(([cat, v]) => ({ cat, spent: v }));
    return { rows, total, used, left: total - used, pct: total ? used / total : null, unbudgeted };
  }

  // ---------- net worth ----------
  function netWorth(s, txs) {
    const bank = bankBalance(s, txs) || 0;
    const assets = s.assets || [];
    const assetValue = sum(assets, (a) => a.current !== '' && a.current != null ? a.current : a.invested);
    const invested = sum(assets, (a) => a.invested);
    const sip = sum(assets, (a) => a.sip);
    const receivable = sum(s.lent || [], iouLeft);
    const loanDebt = sum(s.loans || [], (l) => l.outstanding);
    const cardDebt = sum(s.cards || [], (c) => cardOutstanding(c, txs));
    const owe = sum(s.borrowed || [], iouLeft);
    const totalAssets = bank + assetValue + receivable;
    const liabilities = loanDebt + cardDebt + owe;
    const emergency = sum(assets.filter((a) => a.type === 'Emergency fund'), (a) => a.current || a.invested);
    const savings = sum(assets.filter((a) => a.type === 'Bank savings' || a.type === 'Emergency fund' || a.type === 'Fixed deposit'), (a) => a.current || a.invested);
    return { bank, assetValue, invested, sip, receivable, loanDebt, cardDebt, owe, totalAssets, liabilities, net: totalAssets - liabilities, emergency, savings, emiTotal: sum((s.loans || []).filter((l) => num(l.remainingEmis) > 0), (l) => l.emi) };
  }

  // ---------- goals ----------
  /** Average monthly net savings over the last `n` complete months that have data. */
  function avgMonthlySavings(txs, today, n) {
    const mk = monthKey(today); const vals = [];
    for (let i = 1; i <= (n || 3); i++) {
      const m = monthSummary(txs, shiftMonthKey(mk, -i));
      if (m.count) vals.push(m.net);
    }
    return vals.length ? sum(vals) / vals.length : null;
  }

  function goalProgress(g, s, txs, today) {
    const saved = g.linkNetSavings ? netWorth(s, txs).assetValue : num(g.saved);
    const target = num(g.target); const left = Math.max(0, target - saved);
    const avg = avgMonthlySavings(txs, today, 3);
    const rate = num(g.monthly) || (avg && avg > 0 ? avg : 0) || num(s.savingsTarget && s.savingsTarget.monthly);
    const months = left <= 0 ? 0 : rate > 0 ? Math.ceil(left / rate) : null;
    return { saved, target, left, pct: target ? Math.min(1, saved / target) : 0, rate, months, eta: months == null ? null : addMonths(today, months), rateSource: num(g.monthly) ? 'your plan' : avg && avg > 0 ? '3-month average' : 'monthly target' };
  }

  // ---------- coaching (deterministic) ----------
  function insights(s, txs, today) {
    const out = [];
    const mk = monthKey(today);
    const cur = monthSummary(txs, mk); const prev = monthSummary(txs, shiftMonthKey(mk, -1));
    const dayOfMonth = parse(today).getDate(); const dim = daysInMonth(parse(today).getFullYear(), parse(today).getMonth());
    // Pace vs last month.
    if (prev.spend > 0 && cur.spend > prev.spend * (dayOfMonth / dim) * 1.15 && dayOfMonth >= 5) {
      out.push({ tone: 'warn', title: 'Spending faster than last month', body: 'You have spent ' + fmt(cur.spend) + ' in ' + dayOfMonth + ' days. At this pace the month ends near ' + fmt(cur.spend / dayOfMonth * dim) + ' against ' + fmt(prev.spend) + ' last month.' });
    }
    // Budgets.
    for (const r of budgetStatus(s, txs, mk).rows) {
      if (r.level >= 100) out.push({ tone: 'bad', title: r.cat + ' budget used up', body: fmt(r.spent) + ' spent of ' + fmt(r.budget) + ' (' + Math.round(r.pct * 100) + '%).' });
      else if (r.level >= 75) out.push({ tone: 'warn', title: r.cat + ' at ' + Math.round(r.pct * 100) + '%', body: fmt(r.left) + ' left for the rest of the month.' });
    }
    // Repeated small expenses (last 30 days, same merchant, < ₹500, 4+ times).
    const since = addMonths(today, -1);
    const small = txs.filter((t) => isSpend(t) && t.date > since && num(t.amount) < 500 && t.name);
    for (const m of byKey(small, (t) => t.name.trim().toLowerCase(), () => 1).filter((x) => x.v >= 4).slice(0, 3)) {
      const total = sum(small.filter((t) => t.name.trim().toLowerCase() === m.k), (t) => t.amount);
      out.push({ tone: 'info', title: 'Small repeats: ' + m.k, body: m.v + ' purchases in 30 days, ' + fmt(total) + ' in total. About ' + fmt(total * 12) + ' a year at this rate.' });
    }
    // Biggest category jump vs last month.
    const prevCat = new Map(byKey(monthTx(txs, shiftMonthKey(mk, -1)).filter(isSpend), (t) => t.category, myShare).map((x) => [x.k, x.v]));
    for (const c of byKey(monthTx(txs, mk).filter(isSpend), (t) => t.category, myShare).slice(0, 5)) {
      const p = prevCat.get(c.k) || 0;
      if (p > 0 && c.v > p * 1.3 && c.v - p > 1000) out.push({ tone: 'warn', title: c.k + ' up ' + Math.round((c.v / p - 1) * 100) + '% on last month', body: fmt(c.v) + ' so far against ' + fmt(p) + ' in all of last month.' });
    }
    // Savings rate trend.
    if (prev.income > 0 && prev.savingsRate != null) {
      const prev2 = monthSummary(txs, shiftMonthKey(mk, -2));
      if (prev2.income > 0 && prev2.savingsRate != null) {
        const d = prev.savingsRate - prev2.savingsRate;
        out.push({ tone: d >= 0 ? 'good' : 'warn', title: 'Savings rate ' + (d >= 0 ? 'improved' : 'slipped'), body: 'Last month ' + Math.round(prev.savingsRate * 100) + '%, the month before ' + Math.round(prev2.savingsRate * 100) + '%.' });
      }
    }
    // Card utilisation.
    for (const c of s.cards || []) {
      const o = cardOutstanding(c, txs);
      if (num(c.limit) && o / num(c.limit) > 0.3) out.push({ tone: o / num(c.limit) > 0.6 ? 'bad' : 'warn', title: c.bank + ' card at ' + Math.round(o / num(c.limit) * 100) + '% of limit', body: 'Keeping card use under 30% of the limit protects your credit score. Pay the full amount due, not the minimum.' });
    }
    // Emergency fund.
    const nw = netWorth(s, txs);
    const monthlyNeed = (cur.spend > 0 ? Math.max(cur.spend, prev.spend) : prev.spend) || sum(s.fixed || [], (f) => f.amount) + nw.emiTotal;
    if (monthlyNeed > 0 && nw.emergency < monthlyNeed * 3) out.push({ tone: 'warn', title: 'Emergency fund below 3 months', body: fmt(nw.emergency) + ' covers ' + (nw.emergency / monthlyNeed).toFixed(1) + ' months of spending. Aim for ' + fmt(monthlyNeed * 6) + ' (6 months).' });
    return out;
  }

  /** Weekly summary numbers for the last 7 days vs the 7 before. */
  function weekly(txs, today) {
    const a = addDays(today, -6), b = addDays(today, -13);
    const w = txs.filter((t) => isSpend(t) && t.date >= a && t.date <= today);
    const p = txs.filter((t) => isSpend(t) && t.date >= b && t.date < a);
    return { from: a, to: today, spend: sum(w, myShare), prev: sum(p, myShare), top: byKey(w, (t) => t.category, myShare).slice(0, 3), count: w.length };
  }
  function addDays(s, n) { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); }

  // ---------- duplicates ----------
  function findDuplicate(txs, t) {
    const name = (t.name || '').trim().toLowerCase();
    return txs.find((x) => x.id !== t.id && x.type === t.type && x.date === t.date && num(x.amount) === num(t.amount) &&
      (x.name || '').trim().toLowerCase() === name) || null;
  }

  // ---------- money parsing / format ----------
  const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  function fmt(v, opts) {
    if (v == null || !Number.isFinite(Number(v))) return '—';
    const n = Math.round(Number(v));
    return (n < 0 ? '−' : (opts && opts.sign && n > 0 ? '+' : '')) + '₹' + inr.format(Math.abs(n));
  }
  function fmtShort(v) {
    const n = Math.abs(num(v)); const s = v < 0 ? '−' : '';
    if (n >= 1e7) return s + '₹' + (n / 1e7).toFixed(n >= 1e8 ? 0 : 1) + 'Cr';
    if (n >= 1e5) return s + '₹' + (n / 1e5).toFixed(n >= 1e6 ? 0 : 1) + 'L';
    if (n >= 1e3) return s + '₹' + (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k';
    return s + '₹' + Math.round(n);
  }
  /** Pull a rupee amount out of free text: "₹8,000", "8k", "1.5 lakh", "15000". */
  function parseAmount(text) {
    const m = String(text).replace(/,/g, '').match(/(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*(k|thousand|l|lakh|lakhs|lac|cr|crore)?\b/i);
    if (!m) return null;
    let v = parseFloat(m[1]); const u = (m[2] || '').toLowerCase();
    if (u === 'k' || u === 'thousand') v *= 1e3; else if (u[0] === 'l') v *= 1e5; else if (u[0] === 'c') v *= 1e7;
    return v >= 1 ? v : null;
  }

  /** Purchase check the adviser is given as fixed arithmetic. */
  function purchaseCheck(s, txs, today, amount) {
    const st = safeToSpend(s, txs, today);
    const nw = netWorth(s, txs);
    const after = st.safe == null ? null : st.safe - amount;
    const bankAfter = st.bank == null ? null : st.bank - amount;
    let rule = null;
    if (st.safe != null) {
      if (amount <= st.safe * 0.5) rule = 'YES';
      else if (amount <= st.safe) rule = 'WAIT';
      else rule = 'NO';
    }
    return { amount, safeBefore: st.safe, safeAfter: after, bankAfter, payday: st.payday, dueBeforePayday: st.due, emergencyFund: nw.emergency, ruleOfThumb: rule };
  }

  /** CSV for transactions. */
  function toCSV(txs) {
    const cols = ['date', 'type', 'amount', 'name', 'category', 'method', 'othersOwe', 'notes'];
    const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return [cols.join(',')].concat([...txs].sort((a, b) => a.date.localeCompare(b.date)).map((t) => cols.map((c) => esc(t[c])).join(','))).join('\n');
  }

  function blankState() {
    return {
      v: 1, setupDone: false,
      bank: { amount: '', asOf: '' },
      income: { salary: 67000, payday: 1, sources: [] },
      fixed: [], loans: [], cards: [], assets: [], goals: [], lent: [], borrowed: [], planned: [],
      budgets: {}, customCategories: [], savingsTarget: { monthly: '' }, cushion: 2000,
    };
  }

  const api = {
    DEFAULT_CATEGORIES, INCOME_CATEGORIES, METHODS, CARD_METHODS, CARD_PAYMENT, INVESTMENT, ASSET_TYPES,
    iso, parse, monthKey, isAfter, addMonths, addDays, shiftMonthKey, daysBetween, daysInMonth, nextOnDay, num, sum, uid,
    isSpend, myShare, isCardMethod, monthTx, monthSummary, byKey, cardOutstanding, iouPaid, iouLeft, iouStatus,
    bankBalance, nextPayday, obligations, safeToSpend, savingsStillToSet, budgetStatus, netWorth, avgMonthlySavings,
    goalProgress, insights, weekly, findDuplicate, fmt, fmtShort, parseAmount, purchaseCheck, toCSV, blankState, fixedPaid,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Core = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
