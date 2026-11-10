/* Finance OS — screens, add sheet, adviser, settings, setup, boot. */

function allCategories(p) { return C.DEFAULT_CATEGORIES.concat((p && p.customCategories) || []); }
function monthsWithData(txs) {
  const set = new Set(txs.map((t) => C.monthKey(t.date))); set.add(C.monthKey(today()));
  return [...set].sort().reverse();
}
function healthScore(p, txs, d) {
  const mk = C.monthKey(d); const prev = C.monthSummary(txs, C.shiftMonthKey(mk, -1)); const cur = C.monthSummary(txs, mk);
  const nw = C.netWorth(p, txs); const inc = C.num(p.income && p.income.salary) + C.sum((p.income && p.income.sources) || [], (s) => s.amount);
  const base = prev.income > 0 ? prev : cur;
  const parts = [];
  const sr = base.savingsRate; parts.push({ k: 'Savings rate', got: sr == null ? null : Math.round(Math.max(0, Math.min(1, sr / 0.3)) * 30), of: 30, note: sr == null ? 'record income to score' : pct(sr) + ' (30%+ is full marks)' });
  const need = Math.max(base.spend, C.sum(p.fixed || [], (f) => f.amount) + nw.emiTotal);
  const em = need > 0 ? nw.emergency / need : null; parts.push({ k: 'Emergency fund', got: em == null ? null : Math.round(Math.min(1, em / 6) * 25), of: 25, note: em == null ? 'add expenses to score' : em.toFixed(1) + ' months (6 is full marks)' });
  const dti = inc > 0 ? nw.emiTotal / inc : null; parts.push({ k: 'EMI load', got: dti == null ? null : Math.round(Math.max(0, Math.min(1, (0.4 - dti) / 0.3)) * 20), of: 20, note: dti == null ? 'set salary to score' : pct(dti) + ' of income on EMIs (10% or less is full marks)' });
  const lim = C.sum(p.cards || [], (c) => c.limit); const util = lim > 0 ? nw.cardDebt / lim : null;
  parts.push({ k: 'Card use', got: util == null ? (p.cards || []).length ? null : 15 : Math.round(Math.max(0, Math.min(1, (0.9 - util) / 0.6)) * 15), of: 15, note: util == null ? (p.cards || []).length ? 'add card limits to score' : 'no cards' : pct(util) + ' of limits (30% or less is full marks)' });
  const b = C.budgetStatus(p, txs, mk); const over = b.rows.filter((r) => r.pct >= 1).length;
  parts.push({ k: 'Budgets', got: b.rows.length ? Math.round(10 * (1 - over / b.rows.length)) : null, of: 10, note: b.rows.length ? over + ' of ' + b.rows.length + ' over budget' : 'set budgets to score' });
  const scored = parts.filter((x) => x.got != null);
  const score = scored.length ? Math.round(C.sum(scored, (x) => x.got) / C.sum(scored, (x) => x.of) * 100) : null;
  return { score, parts };
}

/* ===================== Home ===================== */
function Home({ p, txs, go, openAdd, openTx, openSettings, status }) {
  const d = today(); const mk = C.monthKey(d);
  const st = useMemo(() => C.safeToSpend(p, txs, d), [p, txs]);
  const cur = C.monthSummary(txs, mk); const nw = C.netWorth(p, txs); const b = C.budgetStatus(p, txs, mk);
  const [showBreak, setShowBreak] = useState(false);
  const [picked, setPicked] = useState(mk);
  const months = [-5, -4, -3, -2, -1, 0].map((i) => C.monthSummary(txs, C.shiftMonthKey(mk, i)));
  const pm = months.find((m) => m.mk === picked) || months[5];
  const upcoming = C.obligations(p, txs, d, C.addDays(d, 31));
  const hs = healthScore(p, txs, d);
  const expected = C.num(p.income.salary) + C.sum(p.income.sources || [], (s) => s.amount);
  const cats = C.byKey(C.monthTx(txs, mk).filter(C.isSpend), (t) => t.category, C.myShare);
  const hour = new Date().getHours();
  return html`<div class="screen">
    <div class="topbar"><div class="grow"><h1>${hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}</h1><div class="sub">${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })} · <${SaveChip} status=${status} /></div></div>
      <button class="iconbtn" aria-label="Settings" onClick=${openSettings}><${Icon} name="gear" /></button></div>

    <section class=${'hero' + (st.shortfall > 0 ? ' short' : '')} aria-label="Safe to spend">
      <div class="label">Safe to spend</div>
      ${st.safe == null ? html`<div class="big">—</div><div class="meta">Add your current bank balance to calculate this.</div>
        <button class="btn" style=${{ alignSelf: 'flex-start', marginTop: '6px' }} onClick=${openSettings}>Update bank balance</button>`
      : html`<div class="big num">${fmt(st.safe)}</div>
        <div class="meta num">${st.shortfall > 0 ? 'Short by ' + fmt(st.shortfall) + ' for what is due before payday' : 'About ' + fmt(st.perDay) + '/day for ' + st.days + ' days, until payday ' + shortDate(st.payday)}</div>
        <button class="link" style=${{ alignSelf: 'flex-start', marginTop: '4px' }} onClick=${() => setShowBreak(!showBreak)}>${showBreak ? 'Hide' : 'How this is worked out'}</button>
        ${showBreak ? html`<div class="break num">
          <span>Bank balance (estimated)</span><span>${fmt(st.bank)}</span>
          ${st.obligations.map((o, i) => html`<${React.Fragment} key=${i}><span>− ${o.kind}: ${o.name} · ${shortDate(o.date)}</span><span>${fmt(o.amount)}</span></${React.Fragment}>`)}
          ${st.savings ? html`<span>− Savings still to set aside</span><span>${fmt(st.savings)}</span>` : null}
          ${st.cushion ? html`<span>− Safety cushion</span><span>${fmt(st.cushion)}</span>` : null}
          <span style=${{ fontWeight: 700 }}>Safe to spend</span><span style=${{ fontWeight: 700 }}>${fmt(st.safe)}</span>
          <span style=${{ gridColumn: '1 / -1', opacity: .8, fontSize: '12px' }}>Balance last entered ${shortDate(p.bank.asOf)}, then adjusted by everything recorded since. Card purchases count when you pay the bill.</span>
        </div>` : null}`}
    </section>
    ${st.missing.length ? html`<div class="banner warn">Missing: ${st.missing.join(', ')}. Figures that depend on it are left blank.</div>` : null}

    <div class="grid2">
      <button class="stat" onClick=${() => go('budgets')}><span class="k">Budget left</span><span class="v num">${b.total ? fmt(b.left) : '—'}</span><span class="s">${b.total ? pct(b.pct) + ' of ' + fmt(b.total) + ' used' : 'No budgets set'}</span></button>
      <button class="stat" onClick=${() => go('activity')}><span class="k">Spent in ${monthName(mk)}</span><span class="v num">${fmt(cur.spend)}</span><span class="s">Income ${fmt(cur.income)}${cur.income ? '' : ' (expected ' + fmt(expected) + ')'}</span></button>
      <div class="stat"><span class="k">Left this month</span><span class="v num">${fmt((cur.income || expected) - cur.spend)}</span><span class="s">${cur.income ? 'Income' : 'Expected income'} − spending</span></div>
      <div class="stat"><span class="k">Savings rate</span><span class="v num">${pct(cur.savingsRate)}</span><span class="s">${cur.income ? 'Of income received' : 'Record income to see'}</span></div>
    </div>

    <div class="card">
      <h2>Upcoming bills & EMIs<span class="spacer"></span><span class="num" style=${{ textTransform: 'none', color: 'var(--fg)' }}>${fmt(C.sum(upcoming, (o) => o.amount))}</span></h2>
      ${upcoming.length ? upcoming.slice(0, 6).map((o, i) => html`<div class="row" key=${i} style=${{ padding: '7px 0' }}>
        <${Pill} tone=${o.overdue ? 'bad' : C.daysBetween(d, o.date) <= 3 ? 'warn' : ''}>${o.overdue ? 'Overdue' : shortDate(o.date)}</${Pill}>
        <span class="grow ellipsis">${o.name} <span class="muted small">${o.kind}</span></span><span class="num" style=${{ fontWeight: 600 }}>${fmt(o.amount)}</span></div>`)
      : html`<div class="empty">Nothing due in the next 31 days.</div>`}
    </div>

    <div class="card">
      <h2>Recent<span class="spacer"></span><button class="link" onClick=${() => go('activity')}>See all</button></h2>
      ${txs.length ? txs.slice(0, 6).map((t) => html`<${TxRow} key=${t.id} t=${t} onClick=${() => openTx(t)} />`)
      : html`<div class="empty">No transactions yet.<br/><button class="btn primary" style=${{ marginTop: '10px' }} onClick=${openAdd}>Add your first one</button></div>`}
    </div>

    <button class="card" style=${{ border: 0, textAlign: 'left' }} onClick=${() => go('health')}>
      <h2>Financial health</h2>
      <div class="row"><span style=${{ fontFamily: 'var(--font-display)', fontSize: '38px', fontWeight: 700 }} class="num">${hs.score == null ? '—' : hs.score}</span><span class="muted">/100</span>
        <span class="grow"></span>
        <div class="stack" style=${{ gap: '2px', textAlign: 'right' }}><span class="small muted">Net worth</span><span class="num" style=${{ fontWeight: 700 }}>${fmt(nw.net)}</span></div></div>
      <div class="grid3" style=${{ marginTop: '12px' }}>
        <div><div class="small muted">Savings</div><div class="num" style=${{ fontWeight: 600 }}>${fmt(nw.savings + Math.max(0, nw.bank))}</div></div>
        <div><div class="small muted">Debt</div><div class="num" style=${{ fontWeight: 600 }}>${fmt(nw.liabilities)}</div></div>
        <div><div class="small muted">Cards owed</div><div class="num" style=${{ fontWeight: 600 }}>${fmt(nw.cardDebt)}</div></div>
        <div><div class="small muted">EMIs / month</div><div class="num" style=${{ fontWeight: 600 }}>${fmt(nw.emiTotal)}</div></div>
        <div><div class="small muted">Invested</div><div class="num" style=${{ fontWeight: 600 }}>${fmt(nw.assetValue - nw.savings)}</div></div>
        <div><div class="small muted">Owed to you</div><div class="num" style=${{ fontWeight: 600 }}>${fmt(nw.receivable)}</div></div>
      </div>
    </button>

    <div class="card">
      <h2>Cash flow</h2>
      <div class="legend"><span><i style=${{ background: 'var(--c-income)' }}></i>Income</span><span><i style=${{ background: 'var(--c-spend)' }}></i>Spending</span></div>
      <${CashflowChart} months=${months} picked=${picked} onPick=${setPicked} />
      <div class="tip num">${monthName(pm.mk, true)}: income ${fmt(pm.income)}, spending ${fmt(pm.spend)}, net ${fmt(pm.net, { sign: true })}</div>
    </div>

    <div class="card"><h2>Where it went · ${monthName(mk)}</h2><${HBars} rows=${cats} total=${cur.spend} limit=${6} empty="No spending this month yet." /></div>
  </div>`;
}

function SaveChip({ status }) {
  if (status.mode === 'starting') return html`<span class="savechip">Connecting…</span>`;
  if (status.error) return html`<span class="savechip err">Not saved</span>`;
  if (status.saving) return html`<span class="savechip">Saving…</span>`;
  const t = status.lastSaved;
  const where = status.mode === 'cloud' ? 'Saved' : 'Saved on this device';
  return html`<span class="savechip">${t ? where + ' ' + t.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : status.mode === 'cloud' ? 'Synced' : 'This device only'}</span>`;
}

/* ===================== Add / edit transaction ===================== */
function AddSheet({ p, txs, initial, onClose, toast }) {
  const editing = !!(initial && initial.id);
  const lastMethod = lsGet('financeos.lastMethod') || 'UPI';
  const [t, setT] = useState(() => Object.assign({ type: 'expense', amount: '', name: '', category: '', date: today(), method: lastMethod, notes: '', othersOwe: '', owedBy: '', cardId: '' }, initial || {}));
  const [touchedCat, setTouchedCat] = useState(editing || !!(initial && initial.category));
  const [more, setMore] = useState(!!(initial && (initial.notes || initial.othersOwe)));
  const [dup, setDup] = useState(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [newCat, setNewCat] = useState(null);
  const [busy, setBusy] = useState(false);
  const amtRef = useRef();
  useEffect(() => { if (!editing && amtRef.current) amtRef.current.focus(); }, []);
  const set = (k, v) => { setT((o) => Object.assign({}, o, { [k]: v })); setDup(null); };

  const expenseCats = useMemo(() => {
    const freq = C.byKey(txs.filter((x) => x.type === 'expense'), (x) => x.category, () => 1).map((x) => x.k);
    return [...new Set(freq.concat(allCategories(p)))].filter((c) => allCategories(p).includes(c));
  }, [txs.length, p.customCategories]);
  const cats = t.type === 'income' ? C.INCOME_CATEGORIES : expenseCats;
  const names = useMemo(() => [...new Set(txs.slice(0, 300).map((x) => x.name).filter(Boolean))], [txs.length]);
  const onName = (v) => {
    set('name', v);
    const prev = txs.find((x) => (x.name || '').toLowerCase() === v.trim().toLowerCase());
    if (prev && !touchedCat) setT((o) => Object.assign({}, o, { name: v, category: prev.category, method: prev.method, type: prev.type, cardId: prev.cardId || '' }));
  };
  const isCardPay = t.type === 'expense' && t.category === C.CARD_PAYMENT;
  const cardsForMethod = (p.cards || []).filter((c) => c.method === t.method);
  const showCardPick = isCardPay ? (p.cards || []).length > 0 : C.isCardMethod(t.method) && (p.cards || []).length > 0;
  const cardChoices = isCardPay ? (p.cards || []) : (cardsForMethod.length ? cardsForMethod : (p.cards || []));
  const cardId = showCardPick ? (cardChoices.some((c) => c.id === t.cardId) ? t.cardId : (cardChoices[0] && cardChoices[0].id) || '') : '';

  async function save(force) {
    const amount = C.num(t.amount);
    if (!(amount > 0)) { toast('Enter an amount'); return; }
    const category = t.category || (t.type === 'income' ? 'Other income' : 'Other');
    const rec = Object.assign({}, t, { amount, category, name: t.name.trim(), cardId: cardId || '', othersOwe: C.num(t.othersOwe) || '', id: t.id || C.uid(), createdAt: t.createdAt || Date.now() });
    if (rec.type === 'income') { rec.othersOwe = ''; rec.owedBy = ''; }
    if (!force) { const d = C.findDuplicate(txs, rec); if (d) { setDup(d); return; } }
    const mk = C.monthKey(rec.date);
    const before = C.budgetStatus(p, txs, mk).rows.find((r) => r.cat === rec.category);
    setBusy(true);
    lsSet('financeos.lastMethod', rec.method);
    try {
      await saveTx(rec, p);
      const after = C.budgetStatus(p, txs.filter((x) => x.id !== rec.id).concat([rec]), mk).rows.find((r) => r.cat === rec.category);
      if (after && after.level > (before ? before.level : 0)) toast(after.level >= 100 ? '⚠ ' + rec.category + ' is over budget (' + pct(after.pct) + ')' : rec.category + ' budget at ' + pct(after.pct));
      else toast((editing ? 'Updated · ' : 'Saved · ') + fmt(amount) + (rec.name ? ' ' + rec.name : ''));
      onClose();
    } catch (e) { toast('Not saved: ' + ((e && e.code) || 'error') + '. Kept on screen; tap Retry in Settings.'); setBusy(false); onClose(); }
  }
  async function del() {
    setBusy(true);
    try { await deleteTx(t, p); toast('Deleted'); } catch (e) { toast('Delete not saved: ' + ((e && e.code) || 'error')); }
    onClose();
  }
  async function addCategory() {
    const name = (newCat || '').trim(); if (!name) return;
    if (!allCategories(p).includes(name)) await saveProfile(Object.assign({}, p, { customCategories: (p.customCategories || []).concat([name]) }));
    set('category', name); setTouchedCat(true); setNewCat(null);
  }

  return html`<${Sheet} title=${editing ? 'Edit transaction' : 'Add transaction'} onClose=${onClose}>
    <${Seg} value=${t.type} onChange=${(v) => { set('type', v); set('category', ''); setTouchedCat(false); }} options=${[{ v: 'expense', l: 'Expense' }, { v: 'income', l: 'Income' }]} />
    <label class="amount-in" for="tx-amount"><span>₹</span><input id="tx-amount" ref=${amtRef} inputmode="decimal" placeholder="0" class="num" value=${t.amount} onChange=${(e) => set('amount', e.target.value.replace(/[^\d.]/g, ''))} onKeyDown=${(e) => { if (e.key === 'Enter') save(false); }} /></label>
    <${Field} label=${t.type === 'income' ? 'From' : 'Paid to (merchant or person)'}>
      <input id="tx-name" class="input" list="names" autocomplete="off" placeholder=${t.type === 'income' ? 'Employer, client, friend…' : 'Swiggy, landlord, Rahul…'} value=${t.name} onChange=${(e) => onName(e.target.value)} />
      <datalist id="names">${names.map((n) => html`<option key=${n} value=${n} />`)}</datalist>
    </${Field}>
    <div class="field"><span class="lbl">Category</span>
      <div class="chips wrap">${cats.map((c) => html`<button key=${c} class=${'chip' + (t.category === c ? ' on' : '')} onClick=${() => { set('category', c); setTouchedCat(true); }}>${c}</button>`)}
        ${t.type === 'expense' ? (newCat == null ? html`<button class="chip" onClick=${() => setNewCat('')}>+ New</button>`
          : html`<span class="row" style=${{ flexBasis: '100%' }}><input id="tx-newcat" class="input grow" placeholder="New category name" value=${newCat} onChange=${(e) => setNewCat(e.target.value)} /><button class="btn sm primary" onClick=${addCategory}>Add</button></span>`) : null}
      </div></div>
    <div class="field"><span class="lbl">Paid with</span>
      <div class="chips">${C.METHODS.map((m) => html`<button key=${m} class=${'chip' + (t.method === m ? ' on' : '')} onClick=${() => set('method', m)}>${m}</button>`)}</div></div>
    ${showCardPick && cardChoices.length > 1 || isCardPay ? html`<${Field} label=${isCardPay ? 'Paying which card?' : 'Which card?'}>
      <select id="tx-card" class="input" value=${cardId} onChange=${(e) => set('cardId', e.target.value)}>${cardChoices.map((c) => html`<option key=${c.id} value=${c.id}>${c.bank}</option>`)}</select></${Field}>` : null}
    ${isCardPay && !(p.cards || []).length ? html`<div class="banner warn small">Add the card under Health → Debts so this payment reduces its balance.</div>` : null}
    ${isCardPay ? html`<div class="small muted">Bill payments reduce what you owe on the card. They are not counted as spending, because the purchases already were.</div>` : null}
    ${C.isCardMethod(t.method) && !isCardPay && t.type === 'expense' ? html`<div class="small muted">Counts as spending now; leaves your bank account when you pay the card bill.</div>` : null}
    <div class="grid2">
      <${Field} label="Date"><input id="tx-date" class="input" type="date" value=${t.date} onChange=${(e) => set('date', e.target.value)} /></${Field}>
      <div class="field"><span class="lbl">Quick</span><div class="row"><button class="chip" onClick=${() => set('date', today())}>Today</button><button class="chip" onClick=${() => set('date', C.addDays(today(), -1))}>Yesterday</button></div></div>
    </div>
    ${more ? html`<div class="stack">
      <${Field} label="Notes"><textarea id="tx-notes" class="input" value=${t.notes} onChange=${(e) => set('notes', e.target.value)}></textarea></${Field}>
      ${t.type === 'expense' ? html`<div class="grid2">
        <${Field} label="Others owe me (shared bill)"><${NumInput} id="tx-owe" value=${t.othersOwe} onChange=${(v) => set('othersOwe', v)} /></${Field}>
        <${Field} label="Who owes it"><input id="tx-owedby" class="input" value=${t.owedBy} placeholder="Name" onChange=${(e) => set('owedBy', e.target.value)} /></${Field}>
      </div><div class="small muted">Only your share counts as spending; the rest is added to Money owed to me.</div>` : null}
    </div>` : html`<button class="link" style=${{ alignSelf: 'flex-start' }} onClick=${() => setMore(true)}>+ Notes or split with friends</button>`}
    ${dup ? html`<div class="banner warn"><div class="grow">This looks like a duplicate of ${dup.name || dup.category} · ${fmt(dup.amount)} on ${shortDate(dup.date)}.</div><button class="btn sm" onClick=${() => save(true)}>Save anyway</button></div>` : null}
    <button class="btn primary block" disabled=${busy} onClick=${() => save(false)}>${editing ? 'Save changes' : 'Save'}</button>
    ${editing ? (confirmDel ? html`<div class="row"><span class="grow small">Delete this transaction?</span><button class="btn sm" onClick=${() => setConfirmDel(false)}>Keep</button><button class="btn sm danger" onClick=${del}>Delete</button></div>`
      : html`<button class="btn danger block" onClick=${() => setConfirmDel(true)}>Delete</button>`) : null}
  </${Sheet}>`;
}

/* ===================== Activity (transactions + analytics) ===================== */
function Activity({ p, txs, openTx, toast }) {
  const [tab, setTab] = useState('list');
  const [q, setQ] = useState('');
  const [mk, setMk] = useState(C.monthKey(today()));
  const [cat, setCat] = useState('');
  const [method, setMethod] = useState('');
  const months = monthsWithData(txs);
  const filtered = txs.filter((t) => (!mk || C.monthKey(t.date) === mk) && (!cat || t.category === cat) && (!method || t.method === method) &&
    (!q || [t.name, t.category, t.notes, t.date, shortDate(t.date), String(t.amount)].join(' ').toLowerCase().includes(q.toLowerCase())));
  const groups = []; for (const t of filtered) { const g = groups[groups.length - 1]; if (g && g.date === t.date) g.items.push(t); else groups.push({ date: t.date, items: [t] }); }
  const outT = C.sum(filtered.filter(C.isSpend), C.myShare), inT = C.sum(filtered.filter((t) => t.type === 'income'), (t) => t.amount);
  async function exportCSV() {
    try { toast(await saveFile('transactions' + (mk ? '-' + mk : '') + '.csv', C.toCSV(filtered))); }
    catch (e) { if (e.code !== 'declined') toast(e.code === 'unavailable' ? 'Exporting is not available here' : 'Export failed: ' + (e.message || e.code)); }
  }
  return html`<div class="screen">
    <div class="topbar"><h1>Activity</h1></div>
    <${Seg} value=${tab} onChange=${setTab} options=${[{ v: 'list', l: 'Transactions' }, { v: 'insights', l: 'Analytics' }]} />
    <div class="row">
      <select id="act-month" class="input" style=${{ flex: 1 }} value=${mk} onChange=${(e) => setMk(e.target.value)}>
        ${tab === 'list' ? html`<option value="">All months</option>` : null}
        ${months.map((m) => html`<option key=${m} value=${m}>${monthName(m, true)}</option>`)}</select>
    </div>
    ${tab === 'list' ? html`<${React.Fragment}>
      <div class="row"><input id="act-q" class="input" type="search" placeholder="Search name, category, date, amount" value=${q} onChange=${(e) => setQ(e.target.value)} /></div>
      <div class="grid2">
        <select id="act-cat" class="input" value=${cat} onChange=${(e) => setCat(e.target.value)}><option value="">All categories</option>${allCategories(p).concat(C.INCOME_CATEGORIES).map((c) => html`<option key=${c} value=${c}>${c}</option>`)}</select>
        <select id="act-method" class="input" value=${method} onChange=${(e) => setMethod(e.target.value)}><option value="">All methods</option>${C.METHODS.map((c) => html`<option key=${c} value=${c}>${c}</option>`)}</select>
      </div>
      <div class="row small"><span class="grow muted">${filtered.length} transactions · spent ${fmt(outT)} · in ${fmt(inT)}</span><button class="link" onClick=${exportCSV}>Export CSV</button></div>
      <div class="card" style=${{ paddingBlock: '6px' }}>
        ${groups.length ? groups.map((g) => html`<div key=${g.date}>
          <div class="daylabel"><span>${C.parse(g.date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</span><span class="num">${fmt(C.sum(g.items.filter(C.isSpend), C.myShare))}</span></div>
          ${g.items.map((t) => html`<${TxRow} key=${t.id} t=${t} onClick=${() => openTx(t)} />`)}</div>`)
        : html`<div class="empty">No transactions match.</div>`}
      </div></${React.Fragment}>`
    : html`<${Analytics} p=${p} txs=${txs} mk=${mk || C.monthKey(today())} />`}
  </div>`;
}

function Analytics({ p, txs, mk }) {
  const list = C.monthTx(txs, mk); const spend = list.filter(C.isSpend);
  const m = C.monthSummary(txs, mk); const prev = C.monthSummary(txs, C.shiftMonthKey(mk, -1));
  const cats = C.byKey(spend, (t) => t.category, C.myShare);
  const prevCats = new Map(C.byKey(C.monthTx(txs, C.shiftMonthKey(mk, -1)).filter(C.isSpend), (t) => t.category, C.myShare).map((x) => [x.k, x.v]));
  const merchants = C.byKey(spend.filter((t) => t.name), (t) => t.name.trim(), C.myShare);
  const methods = C.byKey(list.filter((t) => t.type === 'expense'), (t) => t.method, (t) => t.amount);
  const weeks = [1, 8, 15, 22, 29].map((d0, i) => ({ k: 'Week ' + (i + 1) + ' (' + d0 + '–' + Math.min(d0 + 6, C.daysInMonth(C.parse(mk + '-01').getFullYear(), C.parse(mk + '-01').getMonth())) + ')', v: C.sum(spend.filter((t) => { const d = C.parse(t.date).getDate(); return d >= d0 && d < d0 + 7; }), C.myShare) })).filter((w, i) => i < 4 || w.v > 0);
  const six = [-5, -4, -3, -2, -1, 0].map((i) => C.monthSummary(txs, C.shiftMonthKey(mk, i)));
  const [picked, setPicked] = useState(mk);
  const pm = six.find((x) => x.mk === picked) || six[5];
  const delta = prev.spend ? (m.spend - prev.spend) / prev.spend : null;
  return html`<${React.Fragment}>
    <div class="grid3">
      <div class="stat"><span class="k">Spent</span><span class="v num">${C.fmtShort(m.spend)}</span><span class="s">${delta == null ? '—' : (delta >= 0 ? '▲ ' : '▼ ') + Math.abs(Math.round(delta * 100)) + '% vs prev'}</span></div>
      <div class="stat"><span class="k">Income</span><span class="v num">${C.fmtShort(m.income)}</span><span class="s">${m.count} transactions</span></div>
      <div class="stat"><span class="k">Saved</span><span class="v num">${pct(m.savingsRate)}</span><span class="s num">${fmt(m.net)}</span></div>
    </div>
    <div class="card"><h2>Daily spending</h2><${DailyBars} mk=${mk} txs=${txs} /></div>
    <div class="card"><h2>Weekly spending</h2><${HBars} rows=${weeks} total=${m.spend} /></div>
    <div class="card"><h2>By category · vs last month</h2>
      ${cats.length ? html`<div class="stack">${cats.map((c) => { const pv = prevCats.get(c.k) || 0; const ch = pv ? (c.v - pv) / pv : null; return html`<div key=${c.k} class="stack" style=${{ gap: '5px' }}>
        <div class="row small"><span class="grow ellipsis" style=${{ fontWeight: 600 }}>${c.k}</span><span class="num">${fmt(c.v)}</span>
          <span class=${'num ' + (ch == null ? 'muted' : '')} style=${{ width: '64px', textAlign: 'right', color: ch == null ? undefined : ch > 0.1 ? 'var(--bad)' : ch < -0.1 ? 'var(--good)' : 'var(--fg-3)' }}>${ch == null ? 'new' : (ch >= 0 ? '+' : '') + Math.round(ch * 100) + '%'}</span></div>
        <div class="bar"><i style=${{ width: (c.v / cats[0].v * 100) + '%' }}></i></div></div>`; })}</div>` : html`<div class="empty">No spending in ${monthName(mk, true)}.</div>`}
    </div>
    <div class="card"><h2>Top merchants & people</h2><${HBars} rows=${merchants} total=${m.spend} limit=${8} /></div>
    <div class="card"><h2>Payment methods</h2><${HBars} rows=${methods} total=${C.sum(methods, (x) => x.v)} /><div class="small muted" style=${{ marginTop: '8px' }}>Includes card-bill payments and investments, so the total can exceed spending.</div></div>
    <div class="card"><h2>Income vs spending · 6 months</h2>
      <div class="legend"><span><i style=${{ background: 'var(--c-income)' }}></i>Income</span><span><i style=${{ background: 'var(--c-spend)' }}></i>Spending</span></div>
      <${CashflowChart} months=${six} picked=${picked} onPick=${setPicked} />
      <div class="tip num">${monthName(pm.mk, true)}: income ${fmt(pm.income)}, spending ${fmt(pm.spend)}</div></div>
    <div class="card"><h2>Savings trend</h2><${TrendLine} points=${six.map((x) => ({ mk: x.mk, v: x.net, rate: x.savingsRate }))} />
      <div class="small muted">Net savings = income − spending. Investments count as saved, not spent.</div></div>
  </${React.Fragment}>`;
}

/* ===================== Budgets & income ===================== */
function Budgets({ p, txs, toast }) {
  const [mk, setMk] = useState(C.monthKey(today()));
  const [edit, setEdit] = useState(null);
  const [draft, setDraft] = useState({});
  const b = C.budgetStatus(p, txs, mk); const prevB = C.budgetStatus(p, txs, C.shiftMonthKey(mk, -1));
  const spendCats = allCategories(p).filter((c) => c !== C.CARD_PAYMENT && c !== C.INVESTMENT);
  const inc = p.income || {};
  const expected = C.num(inc.salary) + C.sum(inc.sources || [], (s) => s.amount);
  const fixedTotal = C.sum(p.fixed || [], (f) => f.amount);
  const nw = C.netWorth(p, txs);
  const save = (patch, msg) => saveProfile(Object.assign({}, p, patch)).then(() => msg && toast(msg)).catch((e) => toast('Not saved: ' + e.code));
  const [incDraft, setIncDraft] = useState(null);
  return html`<div class="screen">
    <div class="topbar"><h1>Budgets</h1>
      <select id="bud-month" class="input" style=${{ width: 'auto' }} value=${mk} onChange=${(e) => setMk(e.target.value)}>${monthsWithData(txs).map((m) => html`<option key=${m} value=${m}>${monthName(m, true)}</option>`)}</select></div>
    <div class="card">
      <h2>${monthName(mk, true)}<span class="spacer"></span><button class="link" onClick=${() => { setDraft(Object.assign({}, p.budgets)); setEdit('budgets'); }}>Edit budgets</button></h2>
      ${b.rows.length ? html`<div class="row" style=${{ alignItems: 'baseline' }}><span style=${{ fontFamily: 'var(--font-display)', fontSize: '30px', fontWeight: 700 }} class="num">${fmt(b.left)}</span><span class="muted">left of ${fmt(b.total)}</span></div>
        <div style=${{ margin: '8px 0 2px' }}><${Bar} value=${b.pct} level=${b.pct >= 1 ? 100 : b.pct >= 0.9 ? 90 : b.pct >= 0.75 ? 75 : 0} /></div>
        <div class="small muted">${pct(b.pct)} used · unused budget does not carry over to next month</div>`
      : html`<div class="empty">No budgets yet. Set a monthly limit for the categories you want to watch.<br/><button class="btn primary" style=${{ marginTop: '10px' }} onClick=${() => { setDraft(Object.assign({}, p.budgets)); setEdit('budgets'); }}>Set budgets</button></div>`}
    </div>
    ${b.rows.map((r) => html`<div class="card" key=${r.cat} style=${{ padding: '14px 16px' }}>
      <div class="row"><span class="grow" style=${{ fontWeight: 700 }}>${r.cat}</span>
        ${r.level ? html`<${Pill} tone=${r.level >= 100 ? 'bad' : 'warn'}>${r.level >= 100 ? 'Over budget' : r.level + '% reached'}</${Pill}>` : null}</div>
      <div style=${{ margin: '10px 0 8px' }}><${Bar} value=${r.pct} level=${r.level} /></div>
      <div class="row small num"><span class="grow">${fmt(r.spent)} of ${fmt(r.budget)} · ${pct(r.pct)}</span><span style=${{ fontWeight: 700, color: r.left < 0 ? 'var(--bad)' : 'var(--fg)' }}>${r.left < 0 ? fmt(-r.left) + ' over' : fmt(r.left) + ' left'}</span></div>
    </div>`)}
    ${b.unbudgeted.length ? html`<div class="card"><h2>Spending without a budget</h2>${b.unbudgeted.map((u) => html`<div class="row small" key=${u.cat} style=${{ padding: '4px 0' }}><span class="grow">${u.cat}</span><span class="num">${fmt(u.spent)}</span></div>`)}</div>` : null}
    ${prevB.rows.length ? html`<div class="small muted">${monthName(C.shiftMonthKey(mk, -1), true)}: ${prevB.left >= 0 ? fmt(prevB.left) + ' unused' : fmt(-prevB.left) + ' over'} across budgets (kept separate, not added to this month).</div>` : null}

    <div class="card"><h2>Monthly income<span class="spacer"></span><button class="link" onClick=${() => setIncDraft(clone(inc))}>Edit</button></h2>
      <div class="kv"><span>Take-home salary</span><span>${fmt(inc.salary)}</span><span>Payday</span><span>Day ${inc.payday || 1}</span>
        ${(inc.sources || []).map((s, i) => html`<${React.Fragment} key=${i}><span>${s.name}</span><span>${fmt(s.amount)}</span></${React.Fragment}>`)}
        <span style=${{ fontWeight: 700 }}>Expected per month</span><span>${fmt(expected)}</span></div>
      <div class="small muted" style=${{ marginTop: '8px' }}>Record actual money received as Income transactions; this is the plan the adviser compares against.</div></div>

    <div class="card"><h2>Fixed monthly costs<span class="spacer"></span><button class="link" onClick=${() => setEdit('fixed')}>Edit</button></h2>
      ${(p.fixed || []).length ? html`<div class="kv">${p.fixed.map((f) => html`<${React.Fragment} key=${f.id}><span>${f.name} <span class="muted small">day ${f.dueDay || '—'}${C.fixedPaid(f, txs, C.monthKey(today())) ? ' · paid' : ''}</span></span><span>${fmt(f.amount)}</span></${React.Fragment}>`)}
        <span>EMIs</span><span>${fmt(nw.emiTotal)}</span><span style=${{ fontWeight: 700 }}>Committed each month</span><span>${fmt(fixedTotal + nw.emiTotal)}</span></div>`
      : html`<div class="empty">Add rent and other fixed bills so Safe to Spend can hold money back for them.</div>`}</div>

    <div class="card"><h2>Planned expenses<span class="spacer"></span><button class="link" onClick=${() => setEdit('planned')}>Edit</button></h2>
      ${(p.planned || []).filter((x) => !x.done).length ? html`<div class="kv">${p.planned.filter((x) => !x.done).map((x) => html`<${React.Fragment} key=${x.id}><span>${x.name} <span class="muted small">${shortDate(x.date)}</span></span><span>${fmt(x.amount)}</span></${React.Fragment}>`)}</div>`
      : html`<div class="empty">Trips, gifts, annual fees… anything dated here is reserved in Safe to Spend.</div>`}</div>

    ${edit === 'budgets' ? html`<${Sheet} title="Monthly budgets" onClose=${() => setEdit(null)}>
      <div class="small muted">Leave blank for no budget. Applies to every month.</div>
      <div class="grid2">${spendCats.map((c) => html`<${Field} key=${c} label=${c}><${NumInput} id=${'b-' + c} value=${draft[c]} onChange=${(v) => setDraft(Object.assign({}, draft, { [c]: v }))} /></${Field}>`)}</div>
      <button class="btn primary block" onClick=${() => { const clean = {}; for (const [k, v] of Object.entries(draft)) if (C.num(v) > 0) clean[k] = C.num(v); save({ budgets: clean }, 'Budgets saved'); setEdit(null); }}>Save budgets</button>
    </${Sheet}>` : null}
    ${edit === 'fixed' ? html`<${EditListSheet} title="Fixed monthly costs" items=${p.fixed} schema=${SCHEMAS.fixed} blank=${BLANKS.fixed} addLabel="Add fixed cost" onClose=${() => setEdit(null)} onSave=${(v) => save({ fixed: v }, 'Fixed costs saved')} />` : null}
    ${edit === 'planned' ? html`<${EditListSheet} title="Planned expenses" items=${(p.planned || []).filter((x) => !x.done)} schema=${SCHEMAS.planned} blank=${BLANKS.planned} addLabel="Add planned expense" onClose=${() => setEdit(null)} onSave=${(v) => save({ planned: v }, 'Saved')} />` : null}
    ${incDraft ? html`<${Sheet} title="Monthly income" onClose=${() => setIncDraft(null)}>
      <div class="grid2"><${Field} label="Take-home salary"><${NumInput} id="inc-sal" value=${incDraft.salary} onChange=${(v) => setIncDraft(Object.assign({}, incDraft, { salary: v }))} /></${Field}>
        <${Field} label="Payday (day of month)"><${NumInput} id="inc-pay" value=${incDraft.payday} onChange=${(v) => setIncDraft(Object.assign({}, incDraft, { payday: Math.min(31, Math.max(1, v || 1)) }))} /></${Field}></div>
      <span class="lbl">Other regular income</span>
      <${ItemsEditor} items=${incDraft.sources || []} setItems=${(s) => setIncDraft(Object.assign({}, incDraft, { sources: s }))} schema=${SCHEMAS.sources} blank=${BLANKS.sources} addLabel="Add income source" />
      <button class="btn primary block" onClick=${() => { save({ income: incDraft }, 'Income saved'); setIncDraft(null); }}>Save</button>
    </${Sheet}>` : null}
  </div>`;
}

/* ===================== Financial health ===================== */
function Health({ p, txs, toast, openAdd }) {
  const [tab, setTab] = useState('overview');
  const [edit, setEdit] = useState(null);
  const d = today();
  const nw = C.netWorth(p, txs); const hs = healthScore(p, txs, d); const ins = C.insights(p, txs, d);
  const save = (patch, msg) => saveProfile(Object.assign({}, p, patch)).then(() => msg && toast(msg)).catch((e) => toast('Not saved: ' + e.code));
  return html`<div class="screen">
    <div class="topbar"><h1>Health</h1></div>
    <${Seg} value=${tab} onChange=${setTab} options=${[{ v: 'overview', l: 'Overview' }, { v: 'debts', l: 'Debts' }, { v: 'savings', l: 'Savings' }, { v: 'iou', l: 'IOUs' }]} />
    ${tab === 'overview' ? html`<${React.Fragment}>
      <div class="card"><h2>Net worth</h2>
        <div style=${{ fontFamily: 'var(--font-display)', fontSize: '36px', fontWeight: 700, letterSpacing: '-.02em' }} class="num">${fmt(nw.net)}</div>
        <div class="kv" style=${{ marginTop: '10px' }}>
          <span>Bank balance (est.)</span><span>${fmt(nw.bank)}</span><span>Savings & investments</span><span>${fmt(nw.assetValue)}</span><span>Owed to you</span><span>${fmt(nw.receivable)}</span>
          <span style=${{ fontWeight: 700 }}>Total assets</span><span>${fmt(nw.totalAssets)}</span>
          <span>Loans</span><span>${fmt(nw.loanDebt)}</span><span>Credit cards</span><span>${fmt(nw.cardDebt)}</span><span>You owe people</span><span>${fmt(nw.owe)}</span>
          <span style=${{ fontWeight: 700 }}>Total liabilities</span><span>${fmt(nw.liabilities)}</span></div></div>
      <div class="card"><h2>Health score<span class="spacer"></span><span class="num" style=${{ fontSize: '20px', color: 'var(--fg)' }}>${hs.score == null ? '—' : hs.score + '/100'}</span></h2>
        <div class="stack">${hs.parts.map((x) => html`<div key=${x.k} class="stack" style=${{ gap: '4px' }}>
          <div class="row small"><span class="grow" style=${{ fontWeight: 600 }}>${x.k}</span><span class="num">${x.got == null ? '—' : x.got + '/' + x.of}</span></div>
          <${Bar} value=${x.got == null ? 0 : x.got / x.of} /><div class="small muted">${x.note}</div></div>`)}</div></div>
      <div class="card"><h2>Coaching</h2>
        ${ins.length ? html`<div class="stack">${ins.map((x, i) => html`<div key=${i} class="row" style=${{ alignItems: 'flex-start' }}>
          <span class=${'pill ' + (x.tone === 'bad' ? 'bad' : x.tone === 'warn' ? 'warn' : 'good')} style=${{ marginTop: '2px' }}><span class="dot"></span></span>
          <div class="grow"><div style=${{ fontWeight: 600 }}>${x.title}</div><div class="small muted">${x.body}</div></div></div>`)}</div>`
        : html`<div class="empty">No warnings right now. Keep recording and this fills in.</div>`}</div>
    </${React.Fragment}>` : null}

    ${tab === 'debts' ? html`<${React.Fragment}>
      <div class="grid2">
        <div class="stat"><span class="k">EMIs per month</span><span class="v num">${fmt(nw.emiTotal)}</span></div>
        <div class="stat"><span class="k">Total debt</span><span class="v num">${fmt(nw.liabilities)}</span></div></div>
      <div class="card"><h2>Loans<span class="spacer"></span><button class="link" onClick=${() => setEdit('loans')}>Edit</button></h2>
        ${(p.loans || []).length ? html`<div class="stack">${p.loans.map((l) => html`<${LoanCard} key=${l.id} l=${l} p=${p} toast=${toast} />`)}</div>` : html`<div class="empty">No loans added.</div>`}</div>
      <div class="card"><h2>Credit cards<span class="spacer"></span><button class="link" onClick=${() => setEdit('cards')}>Edit</button></h2>
        ${(p.cards || []).length ? html`<div class="stack">${p.cards.map((c) => { const o = C.cardOutstanding(c, txs); const u = C.num(c.limit) ? o / C.num(c.limit) : null; return html`<div class="item" key=${c.id}>
          <div class="row"><span class="grow" style=${{ fontWeight: 700 }}>${c.bank}</span>${c.dueDay ? html`<${Pill} tone=${C.daysBetween(d, C.nextOnDay(d, c.dueDay)) <= 5 && o > 0 ? 'warn' : ''}>Due ${shortDate(C.nextOnDay(d, c.dueDay))}</${Pill}>` : null}</div>
          <div class="kv"><span>Outstanding</span><span>${fmt(o)}</span><span>Available limit</span><span>${C.num(c.limit) ? fmt(C.num(c.limit) - o) : '—'}</span>
            <span>Statement total / minimum</span><span>${fmt(c.totalDue)} / ${fmt(c.minDue)}</span><span>Statement day</span><span>${c.statementDay || '—'}</span></div>
          ${u != null ? html`<${Bar} value=${u} level=${u > 0.6 ? 100 : u > 0.3 ? 75 : 0} />` : null}
          <button class="btn sm" style=${{ alignSelf: 'flex-start' }} disabled=${o <= 0} onClick=${() => openAdd({ type: 'expense', category: C.CARD_PAYMENT, name: c.bank + ' card bill', amount: Math.round(C.num(c.totalDue) > 0 ? Math.min(o, C.num(c.totalDue)) : o), method: 'Bank Transfer', cardId: c.id })}>Record bill payment</button>
        </div>`; })}</div>` : html`<div class="empty">No cards added.</div>`}
        <div class="small muted" style=${{ marginTop: '10px' }}>Card purchases count as spending when made. Bill payments only reduce the card balance, so nothing is counted twice.</div></div>
    </${React.Fragment}>` : null}

    ${tab === 'savings' ? html`<${React.Fragment}>
      <div class="grid2">
        <div class="stat"><span class="k">Current value</span><span class="v num">${fmt(nw.assetValue)}</span><span class="s">Invested ${fmt(nw.invested)}</span></div>
        <div class="stat"><span class="k">Monthly SIPs</span><span class="v num">${fmt(nw.sip)}</span><span class="s">Emergency fund ${fmt(nw.emergency)}</span></div></div>
      <div class="card"><h2>Holdings<span class="spacer"></span><button class="link" onClick=${() => setEdit('assets')}>Update values</button></h2>
        ${(p.assets || []).length ? html`<div class="stack">${p.assets.map((a) => { const g = C.num(a.current) - C.num(a.invested); return html`<div class="row" key=${a.id} style=${{ padding: '4px 0' }}>
          <div class="grow" style=${{ minWidth: 0 }}><div class="ellipsis" style=${{ fontWeight: 600 }}>${a.name || a.type}</div><div class="small muted">${a.type}${C.num(a.sip) ? ' · SIP ' + fmt(a.sip) : ''}</div></div>
          <div style=${{ textAlign: 'right' }}><div class="num" style=${{ fontWeight: 700 }}>${fmt(a.current !== '' && a.current != null ? a.current : a.invested)}</div>${C.num(a.invested) && C.num(a.current) ? html`<div class="small num" style=${{ color: g >= 0 ? 'var(--good)' : 'var(--bad)' }}>${fmt(g, { sign: true })}</div>` : null}</div></div>`; })}</div>`
        : html`<div class="empty">Add bank savings, emergency fund, FDs, mutual funds and stocks.</div>`}
        <div class="small muted" style=${{ marginTop: '8px' }}>Values are what you last entered; there is no live market feed.</div></div>
      <div class="card"><h2>Monthly savings target</h2>
        <div class="row"><${NumInput} id="sav-target" value=${(p.savingsTarget || {}).monthly} onChange=${(v) => save({ savingsTarget: { monthly: v } })} /><span class="small muted" style=${{ whiteSpace: 'nowrap' }}>per month</span></div>
        <div class="small muted" style=${{ marginTop: '8px' }}>Held back from Safe to Spend until you record it as an Investments transaction this month.</div></div>
      <div class="card"><h2>Goals<span class="spacer"></span><button class="link" onClick=${() => setEdit('goals')}>Edit</button></h2>
        ${(p.goals || []).length ? html`<div class="stack">${p.goals.map((g) => { const gp = C.goalProgress(g, p, txs, d); return html`<div class="stack" key=${g.id} style=${{ gap: '6px' }}>
          <div class="row"><span class="grow" style=${{ fontWeight: 700 }}>${g.name || 'Goal'}</span><span class="num">${fmt(gp.saved)} / ${fmt(gp.target)}</span></div>
          <${Bar} value=${gp.pct} />
          <div class="small muted">${gp.left <= 0 ? 'Reached.' : gp.months == null ? 'Not enough savings history to estimate a date. Set a planned monthly amount.' : 'At ' + fmt(gp.rate) + '/month (' + gp.rateSource + '): about ' + gp.months + ' months, around ' + monthName(gp.eta.slice(0, 7), true) + '.'}</div></div>`; })}</div>`
        : html`<div class="empty">No goals yet.</div>`}</div>
    </${React.Fragment}>` : null}

    ${tab === 'iou' ? html`<${IOUs} p=${p} toast=${toast} save=${save} />` : null}

    ${edit === 'loans' ? html`<${EditListSheet} title="Loans & EMIs" items=${p.loans} schema=${SCHEMAS.loans} blank=${BLANKS.loans} addLabel="Add loan" onClose=${() => setEdit(null)} onSave=${(v) => save({ loans: v }, 'Loans saved')} />` : null}
    ${edit === 'cards' ? html`<${EditListSheet} title="Credit cards" note="Outstanding shows today's figure, including purchases recorded here. Change it only to match your bank app." items=${cardsForEdit(p.cards, txs)} schema=${SCHEMAS.cards} blank=${BLANKS.cards} addLabel="Add card" onClose=${() => setEdit(null)} onSave=${(v) => save({ cards: cardsFromEdit(v, p.cards, txs) }, 'Cards saved')} />` : null}
    ${edit === 'assets' ? html`<${EditListSheet} title="Savings & investments" items=${p.assets} schema=${SCHEMAS.assets} blank=${BLANKS.assets} addLabel="Add holding" onClose=${() => setEdit(null)} onSave=${(v) => save({ assets: v }, 'Holdings saved')} />` : null}
    ${edit === 'goals' ? html`<${EditListSheet} title="Goals" items=${p.goals} schema=${SCHEMAS.goals} blank=${BLANKS.goals} addLabel="Add goal" onClose=${() => setEdit(null)} onSave=${(v) => save({ goals: v }, 'Goals saved')} />` : null}
  </div>`;
}

function LoanCard({ l, p, toast }) {
  const [confirm, setConfirm] = useState(false);
  const done = C.num(l.remainingEmis) <= 0;
  async function paid() {
    const t = { id: C.uid(), type: 'expense', amount: C.num(l.emi), name: l.lender + ' EMI', category: 'EMIs', date: today(), method: 'Bank Transfer', notes: '', createdAt: Date.now(), loanId: l.id };
    const interest = C.num(l.outstanding) * C.num(l.rate) / 1200;
    const loans = p.loans.map((x) => x.id !== l.id ? x : Object.assign({}, x, {
      remainingEmis: Math.max(0, C.num(x.remainingEmis) - 1), nextDate: x.nextDate ? C.addMonths(x.nextDate, 1) : '',
      outstanding: Math.max(0, Math.round(C.num(x.outstanding) - Math.max(0, C.num(x.emi) - interest))),
    }));
    setConfirm(false);
    try { await Promise.all([saveTx(t, null), saveProfile(Object.assign({}, p, { loans }))]); toast('EMI recorded · ' + fmt(t.amount)); } catch (e) { toast('Not saved: ' + e.code); }
  }
  const paidPct = C.num(l.original) ? 1 - C.num(l.outstanding) / C.num(l.original) : null;
  return html`<div class="item">
    <div class="row"><span class="grow" style=${{ fontWeight: 700 }}>${l.lender || 'Loan'}</span>${done ? html`<${Pill} tone="good">Closed</${Pill}>` : l.nextDate ? html`<${Pill} tone=${l.nextDate < today() ? 'bad' : C.daysBetween(today(), l.nextDate) <= 5 ? 'warn' : ''}>Next ${shortDate(l.nextDate)}</${Pill}>` : null}</div>
    <div class="kv"><span>Outstanding principal</span><span>${fmt(l.outstanding)}</span><span>EMI</span><span>${fmt(l.emi)}</span>
      <span>Interest rate</span><span>${l.rate !== '' && l.rate != null ? l.rate + '%' : '—'}</span><span>EMIs left</span><span>${l.remainingEmis || 0}</span></div>
    ${paidPct != null ? html`<${Bar} value=${paidPct} /><div class="small muted">${pct(paidPct)} of ${fmt(l.original)} repaid</div>` : null}
    ${done ? null : confirm ? html`<div class="row"><span class="grow small">Record ${fmt(l.emi)} paid today?</span><button class="btn sm" onClick=${() => setConfirm(false)}>Cancel</button><button class="btn sm primary" onClick=${paid}>Confirm</button></div>`
      : html`<button class="btn sm" style=${{ alignSelf: 'flex-start' }} onClick=${() => setConfirm(true)}>Mark this month's EMI paid</button>`}
  </div>`;
}

function IOUs({ p, toast, save }) {
  const [side, setSide] = useState('lent');
  const [edit, setEdit] = useState(false);
  const [payFor, setPayFor] = useState(null);
  const [amt, setAmt] = useState('');
  const d = today();
  const list = p[side] || [];
  const total = C.sum(list, C.iouLeft);
  function recordPayment(x) {
    const a = C.num(amt); if (!(a > 0)) return;
    const upd = list.map((y) => y.id !== x.id ? y : Object.assign({}, y, { payments: (y.payments || []).concat([{ amount: Math.min(a, C.iouLeft(y)), date: d }]) }));
    save({ [side]: upd }, side === 'lent' ? 'Repayment received · ' + fmt(a) : 'Payment recorded · ' + fmt(a));
    setPayFor(null); setAmt('');
  }
  return html`<${React.Fragment}>
    <${Seg} value=${side} onChange=${setSide} options=${[{ v: 'lent', l: 'Owed to me' }, { v: 'borrowed', l: 'I owe' }]} />
    <div class="stat"><span class="k">${side === 'lent' ? 'Still to come back to you' : 'You still owe'}</span><span class="v num">${fmt(total)}</span></div>
    <div class="card"><h2>${side === 'lent' ? 'Money owed to me' : 'Money I owe'}<span class="spacer"></span><button class="link" onClick=${() => setEdit(true)}>Add / edit</button></h2>
      ${list.length ? html`<div class="stack">${list.slice().sort((a, b) => C.iouLeft(b) - C.iouLeft(a)).map((x) => { const st = C.iouStatus(x, d); return html`<div class="item" key=${x.id}>
        <div class="row"><span class="grow" style=${{ fontWeight: 700 }}>${x.person || '—'}</span><${Pill} tone=${st === 'Settled' ? 'good' : st === 'Overdue' ? 'bad' : st === 'Partly paid' ? 'warn' : ''}>${st}</${Pill}></div>
        <div class="kv"><span>Amount</span><span>${fmt(x.amount)}</span><span>${side === 'lent' ? 'Received' : 'Paid'}</span><span>${fmt(C.iouPaid(x))}</span><span>Remaining</span><span>${fmt(C.iouLeft(x))}</span>
          <span>${side === 'lent' ? 'Lent on' : 'Borrowed on'}</span><span>${shortDate(x.date)}</span><span>${side === 'lent' ? 'Expected back' : 'Due'}</span><span>${shortDate(side === 'lent' ? x.expected : x.due)}</span></div>
        ${x.notes ? html`<div class="small muted">${x.notes}</div>` : null}
        ${C.iouLeft(x) > 0 ? (payFor === x.id ? html`<div class="row"><${NumInput} id=${'pay-' + x.id} value=${amt} placeholder=${String(C.iouLeft(x))} onChange=${setAmt} /><button class="btn sm primary" onClick=${() => recordPayment(x)}>Save</button><button class="btn sm" onClick=${() => setPayFor(null)}>Cancel</button></div>`
          : html`<button class="btn sm" style=${{ alignSelf: 'flex-start' }} onClick=${() => { setPayFor(x.id); setAmt(C.iouLeft(x)); }}>${side === 'lent' ? 'Record money received' : 'Record a payment'}</button>`) : null}
      </div>`; })}</div>` : html`<div class="empty">${side === 'lent' ? 'Nobody owes you money. Shared bills you split in Add land here automatically.' : 'You do not owe anyone.'}</div>`}</div>
    ${edit ? html`<${EditListSheet} title=${side === 'lent' ? 'Money owed to me' : 'Money I owe'} items=${list} schema=${SCHEMAS[side]} blank=${BLANKS[side]} addLabel="Add entry" onClose=${() => setEdit(false)} onSave=${(v) => save({ [side]: v }, 'Saved')}
      note=${side === 'lent' ? 'Entries dated after your last bank-balance update are deducted from the balance (the money left your account).' : 'Entries dated after your last bank-balance update are added to the balance (the money came in).'} />` : null}
  </${React.Fragment}>`;
}
