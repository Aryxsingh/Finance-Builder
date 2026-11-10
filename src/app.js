/* Finance OS — AI adviser, settings, first-run setup, app shell. */

/* ===================== Adviser ===================== */
function adviserData(p, txs, d) {
  const mk = C.monthKey(d);
  const st = C.safeToSpend(p, txs, d); const nw = C.netWorth(p, txs); const cur = C.monthSummary(txs, mk);
  const b = C.budgetStatus(p, txs, mk);
  const hist = [-3, -2, -1].map((i) => C.monthSummary(txs, C.shiftMonthKey(mk, i)));
  const missing = st.missing.slice();
  if (!nw.emergency) missing.push('emergency fund amount');
  if (!C.num(p.savingsTarget && p.savingsTarget.monthly)) missing.push('monthly savings target');
  if ((p.cards || []).some((c) => !C.num(c.dueDay))) missing.push('a credit-card due date');
  if ((p.loans || []).some((l) => !l.nextDate)) missing.push('a loan next-EMI date');
  if (!txs.length) missing.push('any recorded transactions');
  const L = [];
  L.push('TODAY: ' + d + ' (day ' + C.parse(d).getDate() + ' of ' + C.daysInMonth(C.parse(d).getFullYear(), C.parse(d).getMonth()) + ')');
  L.push('BANK BALANCE (estimated): ' + (st.bank == null ? 'UNKNOWN' : fmt(st.bank) + ' — last entered by user on ' + p.bank.asOf + ', rolled forward with recorded transactions'));
  L.push('NEXT PAYDAY: ' + st.payday + ' (' + st.days + ' days away). Take-home salary: ' + fmt(p.income.salary) + '. Other expected monthly income: ' + fmt(C.sum(p.income.sources || [], (s) => s.amount)));
  L.push('SAFE TO SPEND until payday: ' + (st.safe == null ? 'UNKNOWN' : fmt(st.safe) + ' (≈' + fmt(st.perDay) + '/day)') + (st.shortfall ? '. SHORTFALL of ' + fmt(st.shortfall) + ' against obligations' : ''));
  L.push('  = bank − obligations before payday ' + fmt(st.due) + ' − savings still to set aside this month ' + fmt(st.savings) + ' − cushion ' + fmt(st.cushion));
  L.push('OBLIGATIONS BEFORE PAYDAY: ' + (st.obligations.map((o) => o.kind + ' ' + o.name + ' ' + fmt(o.amount) + ' on ' + o.date + (o.minDue ? ' (min due ' + fmt(o.minDue) + ')' : '')).join('; ') || 'none'));
  L.push('FIXED MONTHLY COSTS: ' + ((p.fixed || []).map((f) => f.name + ' ' + fmt(f.amount) + ' day ' + f.dueDay).join('; ') || 'none entered'));
  L.push('LOANS: ' + ((p.loans || []).map((l) => l.lender + ': outstanding ' + fmt(l.outstanding) + ', EMI ' + fmt(l.emi) + ', ' + (l.rate || '?') + '% p.a., ' + (l.remainingEmis || 0) + ' EMIs left, next ' + (l.nextDate || '?')).join('; ') || 'none') + '. Total EMIs/month ' + fmt(nw.emiTotal));
  L.push('CREDIT CARDS: ' + ((p.cards || []).map((c) => c.bank + ': outstanding ' + fmt(C.cardOutstanding(c, txs)) + ', limit ' + fmt(c.limit) + ', statement total ' + fmt(c.totalDue) + ', min due ' + fmt(c.minDue) + ', due day ' + (c.dueDay || '?')).join('; ') || 'none'));
  L.push('THIS MONTH (' + mk + '): income received ' + fmt(cur.income) + ', spent ' + fmt(cur.spend) + ', invested ' + fmt(cur.invested) + ', savings rate ' + pct(cur.savingsRate));
  L.push('BUDGETS: ' + (b.rows.map((r) => r.cat + ' ' + fmt(r.spent) + '/' + fmt(r.budget) + ' (' + pct(r.pct) + ')').join('; ') || 'none set'));
  L.push('LAST 3 MONTHS: ' + hist.map((h) => h.mk + ' income ' + fmt(h.income) + ' spent ' + fmt(h.spend) + ' saved ' + pct(h.savingsRate)).join('; '));
  L.push('TOP CATEGORIES THIS MONTH: ' + (C.byKey(C.monthTx(txs, mk).filter(C.isSpend), (t) => t.category, C.myShare).slice(0, 6).map((x) => x.k + ' ' + fmt(x.v)).join('; ') || 'none'));
  L.push('TOP MERCHANTS (60 days): ' + (C.byKey(txs.filter((t) => C.isSpend(t) && t.date > C.addDays(d, -60) && t.name), (t) => t.name.trim(), C.myShare).slice(0, 8).map((x) => x.k + ' ' + fmt(x.v)).join('; ') || 'none'));
  L.push('SAVINGS & INVESTMENTS: total ' + fmt(nw.assetValue) + ' (emergency fund ' + fmt(nw.emergency) + ', SIPs ' + fmt(nw.sip) + '/month). Monthly savings target ' + fmt((p.savingsTarget || {}).monthly));
  L.push('GOALS: ' + ((p.goals || []).map((g) => { const gp = C.goalProgress(g, p, txs, d); return g.name + ' ' + fmt(gp.saved) + '/' + fmt(gp.target) + (gp.eta ? ', ETA ' + gp.eta.slice(0, 7) : ''); }).join('; ') || 'none'));
  L.push('PLANNED EXPENSES: ' + ((p.planned || []).filter((x) => !x.done).map((x) => x.name + ' ' + fmt(x.amount) + ' on ' + x.date).join('; ') || 'none'));
  L.push('OWED TO USER: ' + fmt(nw.receivable) + '. USER OWES PEOPLE: ' + fmt(nw.owe));
  L.push('NET WORTH: ' + fmt(nw.net) + ' (assets ' + fmt(nw.totalAssets) + ', liabilities ' + fmt(nw.liabilities) + ')');
  L.push('MISSING INFORMATION: ' + (missing.join(', ') || 'none'));
  return L.join('\n');
}

const ADVISER_RULES = `You are the user's personal financial adviser inside their finance app. They live in India; all money is INR, written like ₹8,000 or ₹1,50,000.
Rules:
- Use ONLY the figures in DATA and PURCHASE CHECK. Never invent balances, incomes or prices. If something you need is listed as MISSING or UNKNOWN, say exactly what is missing and ask the user to add it (Settings or the relevant tab) before giving a firm answer.
- Be financially disciplined. Do not approve a purchase just because the user wants it. Protect, in order: essential bills and EMIs, the full credit-card amount due (never suggest paying only the minimum), the emergency fund, the monthly savings target.
- For any question about buying, spending or affording something, the FIRST line of your reply must be exactly one of: "VERDICT: YES", "VERDICT: WAIT", "VERDICT: NO".
  YES = fits within Safe to Spend with a comfortable margin (as a guide, a discretionary purchase under about half of Safe to Spend) and touches no obligation, savings target or emergency fund.
  WAIT = possible, but better after the next payday or once a card bill is cleared; say the date.
  NO = would eat into obligations, the savings target or the emergency fund, or would leave card debt that cannot be paid in full.
  Then give these short sections, each starting on its own line: "Why:", "Available now:", "After buying:", "Savings target:", "Comfortably affordable:" (when, with a date or a monthly set-aside plan).
- For other questions answer directly with numbers from DATA, no VERDICT line.
- Plain text only, no markdown symbols, no tables. Under 200 words. Short sentences.`;

function Adviser({ p, txs }) {
  const [turns, setTurns] = useState([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [sample, setSample] = useState(undefined);
  const ctl = useRef(null);
  const endRef = useRef();
  useEffect(() => { useCap('sample').then((s) => { const k = lsGet(API_KEY_KEY); setSample(() => s || (k ? makeApiSampler(k) : null)); }).catch(() => setSample(null)); }, []);
  useEffect(() => { if (endRef.current) endRef.current.scrollIntoView({ block: 'end' }); }, [turns]);
  const d = today();
  const data = adviserData(p, txs, d);

  async function ask(text, kind) {
    if (!text.trim() || busy || !sample) return;
    const amount = kind === 'weekly' ? null : C.parseAmount(text);
    let extra = '';
    if (amount) {
      const pc = C.purchaseCheck(p, txs, d, amount);
      extra = '\nPURCHASE CHECK (pre-computed, use these numbers): amount ' + fmt(amount) + '; Safe to Spend before ' + fmt(pc.safeBefore) + ', after ' + fmt(pc.safeAfter) + '; bank balance after ' + fmt(pc.bankAfter) + '; obligations before payday ' + fmt(pc.dueBeforePayday) + '; next payday ' + pc.payday + '; emergency fund ' + fmt(pc.emergencyFund) + '; app rule-of-thumb verdict ' + (pc.ruleOfThumb || 'UNKNOWN (missing data)') + ' (you may be stricter, e.g. if the item is non-essential or a budget is already exceeded).';
    }
    if (kind === 'weekly') {
      const w = C.weekly(txs, d);
      extra = '\nWEEK ' + w.from + ' to ' + w.to + ': spent ' + fmt(w.spend) + ' in ' + w.count + ' transactions (previous 7 days ' + fmt(w.prev) + '). Top: ' + (w.top.map((x) => x.k + ' ' + fmt(x.v)).join(', ') || 'none') +
        '\nAPP INSIGHTS: ' + (C.insights(p, txs, d).map((x) => x.title + ' — ' + x.body).join(' | ') || 'none') +
        '\nWrite a weekly financial health summary with these sections, each on its own line: "This week:", "Watch:", "Wins:", "Next 7 days:" (2-3 concrete actions with ₹ amounts), "Debt:" (is it going down), "Savings:" (on track or not). No VERDICT line.';
    }
    const display = kind === 'weekly' ? 'Give me my weekly financial health summary.' : text.trim();
    const history = turns.filter((t) => !t.error).slice(-6).map((t) => ({ role: t.role, content: t.content }));
    const input = [{ role: 'user', content: ADVISER_RULES + '\n\nDATA (from the app, as of now):\n' + data }].concat(history, [{ role: 'user', content: display + extra }]);
    const id = C.uid();
    setTurns((ts) => ts.concat([{ id: id + 'q', role: 'user', content: display }, { id, role: 'assistant', content: '', thinking: true }]));
    setQ(''); setBusy(true);
    ctl.current = new AbortController();
    try {
      const { text: out } = await sample(input, { cache: false, signal: ctl.current.signal, onText: ({ text: t }) => setTurns((ts) => ts.map((x) => x.id === id ? Object.assign({}, x, { content: t, thinking: false }) : x)) });
      setTurns((ts) => ts.map((x) => x.id === id ? Object.assign({}, x, { content: out, thinking: false }) : x));
    } catch (e) {
      const msg = e.code === 'not_granted' ? 'Claude access was not allowed for this app. Allow it from the artifact permissions to use the adviser.'
        : e.code === 'rate_limited' ? 'Usage limit reached for now. Try again a little later.'
        : e.code === 'cancelled' ? (e.text || '') + '\n(Stopped)'
        : e.code === 'bad_key' ? 'Your Anthropic API key was rejected. Check it in Settings.'
        : e.code === 'network' ? 'No internet connection. The adviser needs to be online.'
        : 'The adviser could not answer (' + e.code + ')' + (e.message ? ': ' + e.message : '') + '.';
      setTurns((ts) => ts.map((x) => x.id === id ? Object.assign({}, x, { content: msg, thinking: false, error: e.code !== 'cancelled' }) : x));
    }
    setBusy(false);
  }

  const chips = ['Can I spend ₹8,000 on shoes?', 'Can I afford a ₹15,000 phone?', 'How much can I spend this weekend?', 'Am I overspending on food?', 'Should I pay my credit-card debt first?', 'How much should I save this month?', 'How much will I have left by month end?', 'Can I afford a vacation next month?', 'Can I afford to buy a car?'];
  return html`<div class="screen">
    <div class="topbar"><h1>Adviser</h1>${turns.length ? html`<button class="btn sm" onClick=${() => setTurns([])}>New chat</button>` : null}</div>
    ${sample === null ? html`<div class="banner warn">${IS_APP ? 'To use the adviser in the app, add your Anthropic API key in Settings (gear icon on Home). Everything else works without it.' : 'The AI adviser needs this page to be open inside Claude with access to Claude allowed. Everything else in the app works without it.'}</div>` : null}
    ${!turns.length ? html`<div class="card"><h2>Ask about your money</h2>
      <div class="small muted" style=${{ marginBottom: '10px' }}>Answers use your recorded balance, bills, EMIs, cards, budgets and goals. Purchase questions get YES, WAIT or NO.</div>
      <div class="chips wrap">${chips.map((c) => html`<button key=${c} class="chip" disabled=${!sample} onClick=${() => ask(c)}>${c}</button>`)}</div>
      <button class="btn primary block" style=${{ marginTop: '12px' }} disabled=${!sample} onClick=${() => ask('weekly', 'weekly')}>Weekly health summary</button></div>` : null}
    <div class="msgs">${turns.map((t) => t.role === 'user' ? html`<div key=${t.id} class="msg me">${t.content}</div>` : html`<${AiMsg} key=${t.id} t=${t} />`)}<div ref=${endRef}></div></div>
    <details><summary>What the adviser sees</summary><pre class="ctx">${data}</pre></details>
    <div class="composer">
      <textarea id="adv-q" class="input" rows="1" placeholder="Can I afford…?" value=${q} onChange=${(e) => setQ(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(q); } }}></textarea>
      ${busy ? html`<button class="btn" onClick=${() => ctl.current && ctl.current.abort()}>Stop</button>` : html`<button class="btn primary" aria-label="Ask" disabled=${!sample || !q.trim()} onClick=${() => ask(q)}><span style=${{ width: '20px', height: '20px', display: 'inline-block' }}><${Icon} name="send" /></span></button>`}
    </div>
  </div>`;
}
function AiMsg({ t }) {
  if (t.thinking) return html`<div class="msg ai muted">Thinking…</div>`;
  const clean = (t.content || '').replace(/\*\*(.*?)\*\*/g, '$1').replace(/^#+\s*/gm, '');
  const m = clean.match(/^\s*VERDICT:\s*(YES|WAIT|NO)\b[^\n]*\n?/i);
  const v = m && m[1].toUpperCase();
  const label = { YES: 'YES · Affordable', WAIT: 'WAIT · Not right now', NO: 'NO · Avoid this purchase' };
  return html`<div class="msg ai">${v ? html`<div class=${'verdict ' + v}>${label[v]}</div>` : null}${v ? clean.slice(m[0].length) : clean}</div>`;
}

/* ===================== Settings ===================== */
function Settings({ p, txs, status, onClose, toast, rerunSetup }) {
  const [bank, setBank] = useState('');
  const [theme, setTheme] = useState(lsGet('financeos.theme') || 'system');
  const [imp, setImp] = useState(null);
  const [cushion, setCushion] = useState(p.cushion);
  const fileRef = useRef();
  const bal = C.bankBalance(p, txs);
  async function saveBank() {
    if (bank === '') return;
    try { await saveProfile(Object.assign({}, p, { bank: { amount: C.num(bank), asOf: today(), asOfTs: Date.now() } })); toast('Bank balance updated'); setBank(''); } catch (e) { toast('Not saved: ' + e.code); }
  }
  function applyTheme(v) { setTheme(v); lsSet('financeos.theme', v); applyThemeAttr(v); }
  async function download(name, data) {
    try { toast(await saveFile(name, data)); }
    catch (e) { if (e.code !== 'declined') toast(e.code === 'unavailable' ? 'Exporting is not available here' : 'Export failed: ' + (e.message || e.code)); }
  }
  const backup = () => JSON.stringify({ app: 'finance-os', version: 1, exportedAt: new Date().toISOString(), profile: p, transactions: txs }, null, 1);
  function onFile(e) {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const j = JSON.parse(r.result);
        if (j.app !== 'finance-os' || !j.profile || !Array.isArray(j.transactions)) throw new Error('not a Finance OS backup');
        setImp(j);
      } catch (err) { toast('That file is not a Finance OS backup'); }
    };
    r.readAsText(f); e.target.value = '';
  }
  async function doImport() {
    const j = imp; setImp(null);
    const months = {};
    for (const t of j.transactions) (months[C.monthKey(t.date)] = months[C.monthKey(t.date)] || []).push(t);
    for (const k of Object.keys(store.docs)) if (k.startsWith('tx-') && !months[k.slice(3)]) months[k.slice(3)] = [];
    try {
      await Promise.all([saveProfile(Object.assign({}, j.profile, { setupDone: true }))].concat(Object.entries(months).map(([mk, items]) => store.write('tx-' + mk, { items }))));
      toast('Backup restored · ' + j.transactions.length + ' transactions');
    } catch (e) { toast('Restore incomplete: ' + e.code); }
  }
  return html`<${Sheet} title="Settings" onClose=${onClose}>
    <div class="card"><h2>Your data</h2>
      ${status.mode === 'cloud' ? html`<div class="small">Saved privately to your Claude account (only you can read it), so it is there on your iPhone and any other device where you open this app.</div>`
      : IS_APP ? html`<div class="small">Saved on this phone only. Uninstalling the app or clearing its storage deletes it, and it does not sync with the Claude artifact. Export a backup regularly.</div>`
      : html`<div class="banner bad small">Cloud storage is not available in this view, so data is saved in this browser only. It can be lost if browser data is cleared, and it will not appear on other devices. Export a backup regularly.</div>`}
      <div class="kv" style=${{ marginTop: '10px' }}><span>Last saved</span><span>${status.lastSaved ? status.lastSaved.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—'}</span>
        <span>Transactions stored</span><span>${txs.length}</span></div>
      ${status.error ? html`<div class="banner bad small" style=${{ marginTop: '10px' }}><div class="grow">${status.error}</div>${status.failedDocs.length ? html`<button class="btn sm" onClick=${() => store.retry()}>Retry</button>` : null}</div>` : null}
    </div>
    <div class="card"><h2>Bank balance</h2>
      <div class="small muted" style=${{ marginBottom: '8px' }}>Current estimate ${fmt(bal)}${p.bank.asOf ? ' (you last entered ' + fmt(p.bank.amount) + ' on ' + shortDate(p.bank.asOf) + ')' : ''}. Enter what your bank app shows to correct it.</div>
      <div class="row"><${NumInput} id="set-bank" value=${bank} placeholder="Balance in bank app" onChange=${setBank} /><button class="btn primary" onClick=${saveBank}>Update</button></div></div>
    <div class="card"><h2>Safety cushion</h2>
      <div class="small muted" style=${{ marginBottom: '8px' }}>Always kept back from Safe to Spend.</div>
      <div class="row"><${NumInput} id="set-cushion" value=${cushion} onChange=${setCushion} /><button class="btn" onClick=${() => saveProfile(Object.assign({}, p, { cushion: C.num(cushion) })).then(() => toast('Saved'))}>Save</button></div></div>
    ${IS_APP ? html`<${ApiKeyCard} toast=${toast} />` : null}
    <div class="card"><h2>Appearance</h2><${Seg} value=${theme} onChange=${applyTheme} options=${[{ v: 'system', l: 'System' }, { v: 'light', l: 'Light' }, { v: 'dark', l: 'Dark' }]} /></div>
    <div class="card"><h2>Backup & restore</h2><div class="stack">
      <button class="btn block" onClick=${() => download('finance-os-backup-' + today() + '.json', backup())}>Export full backup (JSON)</button>
      <button class="btn block" onClick=${() => download('transactions-' + today() + '.csv', C.toCSV(txs))}>Export transactions (CSV)</button>
      <button class="btn block" onClick=${() => fileRef.current.click()}>Restore from backup…</button>
      <input ref=${fileRef} id="set-import" type="file" accept=".json,application/json" hidden onChange=${onFile} />
      ${imp ? html`<div class="banner warn"><div class="grow">Replace everything with the backup from ${shortDate((imp.exportedAt || '').slice(0, 10))} (${imp.transactions.length} transactions)? Current data will be overwritten.</div></div>
        <div class="row"><button class="btn grow" onClick=${() => setImp(null)}>Cancel</button><button class="btn danger grow" onClick=${doImport}>Replace my data</button></div>` : null}
    </div></div>
    <div class="card"><h2>Custom categories</h2>
      ${(p.customCategories || []).length ? html`<div class="chips wrap">${p.customCategories.map((c) => html`<button key=${c} class="chip" onClick=${() => saveProfile(Object.assign({}, p, { customCategories: p.customCategories.filter((x) => x !== c) })).then(() => toast('Removed ' + c))}>${c} ✕</button>`)}</div>`
      : html`<div class="small muted">Add one from the category list when adding a transaction.</div>`}</div>
    <button class="btn block" onClick=${rerunSetup}>Run the setup again</button>
    <div class="small muted">Safe to Spend = estimated bank balance − bills, EMIs, card dues, planned expenses and debts due before payday − savings still to set aside this month − cushion.</div>
  </${Sheet}>`;
}

function ApiKeyCard({ toast }) {
  const [key, setKey] = useState('');
  const has = !!lsGet(API_KEY_KEY);
  return html`<div class="card"><h2>AI adviser</h2>
    <div class="small muted" style=${{ marginBottom: '8px' }}>The app calls Claude with your own Anthropic API key (console.anthropic.com). Usage is billed to that key. The key is stored only on this phone.</div>
    <div class="row"><input id="set-apikey" class="input" type="password" autocomplete="off" placeholder=${has ? 'Key saved. Paste a new one to replace' : 'sk-ant-…'} value=${key} onChange=${(e) => setKey(e.target.value.trim())} />
      <button class="btn primary" onClick=${() => { if (!key) return; lsSet(API_KEY_KEY, key); setKey(''); toast('API key saved'); }}>Save</button></div>
    ${has ? html`<button class="link" style=${{ marginTop: '8px', color: 'var(--bad)' }} onClick=${() => { try { localStorage.removeItem(API_KEY_KEY); } catch (e) {} toast('API key removed'); setKey(' '); setKey(''); }}>Remove key</button>` : null}
  </div>`;
}

let initialThemeAttr = null;
function applyThemeAttr(v) {
  const el = document.documentElement;
  if (initialThemeAttr === null) initialThemeAttr = el.getAttribute('data-theme') || '';
  if (v === 'light' || v === 'dark') el.setAttribute('data-theme', v);
  else if (initialThemeAttr) el.setAttribute('data-theme', initialThemeAttr); else el.removeAttribute('data-theme');
}

/* ===================== First-run setup ===================== */
const SETUP_STEPS = ['Welcome', 'Money now', 'Fixed costs', 'Loans & EMIs', 'Credit cards', 'Savings', 'Targets'];
function Setup({ existing, txs, onDone, onCancel }) {
  const [i, setI] = useState(existing ? 1 : 0);
  const [s, setS] = useState(() => {
    const b = existing ? Object.assign(C.blankState(), clone(existing), { cards: cardsForEdit(existing.cards, txs) }) : C.blankState();
    if (!existing) {
      b.fixed = [{ id: C.uid(), name: 'Rent', category: 'Rent', amount: '', dueDay: 5 }];
      b.loans = [{ id: C.uid(), lender: '', original: '', outstanding: '', emi: 9519, rate: '', remainingEmis: '', nextDate: '' }];
      b.cards = [{ id: C.uid(), bank: 'HDFC', method: 'HDFC Credit Card', limit: '', outstanding: '', statementDay: '', dueDay: '', totalDue: '', minDue: '' }];
      b.assets = [{ id: C.uid(), type: 'Emergency fund', name: 'Emergency fund', invested: '', current: '', sip: '' }, { id: C.uid(), type: 'Bank savings', name: 'Savings account', invested: '', current: '', sip: '' }];
      b.goals = [{ id: C.uid(), name: 'Savings goal', target: 500000, saved: '', monthly: '', linkNetSavings: true }];
    }
    return b;
  });
  const [bank, setBank] = useState(existing ? '' : '');
  const set = (patch) => setS((o) => Object.assign({}, o, patch));
  const has = (x, keys) => keys.some((k) => x[k] !== '' && x[k] != null && x[k] !== 0);
  async function finish() {
    const out = Object.assign({}, s, { setupDone: true });
    out.fixed = s.fixed.filter((x) => C.num(x.amount) > 0);
    out.loans = s.loans.filter((x) => has(x, ['lender', 'outstanding', 'original']) || (C.num(x.emi) > 0 && x.lender));
    out.cards = existing ? cardsFromEdit(s.cards, existing.cards, txs) : s.cards.filter((x) => has(x, ['limit', 'outstanding', 'dueDay'])).map((c) => Object.assign({}, c, { asOf: today(), asOfTs: Date.now() }));
    out.assets = s.assets.filter((x) => has(x, ['invested', 'current']));
    out.goals = s.goals.filter((x) => C.num(x.target) > 0);
    if (bank !== '') out.bank = { amount: C.num(bank), asOf: today(), asOfTs: Date.now() };
    await onDone(out);
  }
  const step = SETUP_STEPS[i];
  return html`<div class="screen" style=${{ paddingTop: '8px' }}>
    <div class="topbar" style=${{ flexDirection: 'column', alignItems: 'stretch', gap: '10px' }}>
      <div class="steps">${SETUP_STEPS.map((_, j) => html`<i key=${j} class=${j <= i ? 'on' : ''}></i>`)}</div>
      <div class="row"><h1>${step}</h1>${onCancel ? html`<button class="iconbtn" aria-label="Close setup" onClick=${onCancel}><${Icon} name="x" /></button>` : null}</div>
    </div>
    ${i === 0 ? html`<div class="card stack">
      <div style=${{ fontSize: '17px', lineHeight: 1.5 }}>Let's set up your money picture. It takes about three minutes, and every step can be skipped and edited later.</div>
      <div class="small muted">Some fields start with figures from your notes (salary ₹67,000, EMI ₹9,519, ₹5 lakh goal). They are only starting points: check each one against your bank app. Old balances are never assumed.</div></div>` : null}
    ${i === 1 ? html`<div class="card stack">
      <${Field} label="Current bank balance (from your bank app today)"><${NumInput} id="su-bank" value=${bank} placeholder=${existing ? 'Leave blank to keep the current estimate' : 'e.g. 42000'} onChange=${setBank} /></${Field}>
      <div class="grid2"><${Field} label="Monthly take-home salary"><${NumInput} id="su-salary" value=${s.income.salary} onChange=${(v) => set({ income: Object.assign({}, s.income, { salary: v }) })} /></${Field}>
        <${Field} label="Payday (day of month)"><${NumInput} id="su-payday" value=${s.income.payday} onChange=${(v) => set({ income: Object.assign({}, s.income, { payday: Math.min(31, Math.max(1, v || 1)) }) })} /></${Field}></div>
      <span class="lbl">Other regular income (freelance, rent received…)</span>
      <${ItemsEditor} items=${s.income.sources || []} setItems=${(v) => set({ income: Object.assign({}, s.income, { sources: v }) })} schema=${SCHEMAS.sources} blank=${BLANKS.sources} addLabel="Add income source" />
    </div>` : null}
    ${i === 2 ? html`<div class="stack"><div class="small muted">Rent, utilities, phone, subscriptions, SIPs paid by mandate… anything that leaves every month. Rows left at zero are skipped.</div>
      <${ItemsEditor} items=${s.fixed} setItems=${(v) => set({ fixed: v })} schema=${SCHEMAS.fixed} blank=${BLANKS.fixed} addLabel="Add fixed cost" /></div>` : null}
    ${i === 3 ? html`<div class="stack"><div class="small muted">The EMI of ₹9,519 is from your notes. Confirm it and fill in the lender, outstanding amount and next date, or remove the row.</div>
      <${ItemsEditor} items=${s.loans} setItems=${(v) => set({ loans: v })} schema=${SCHEMAS.loans} blank=${BLANKS.loans} addLabel="Add loan" /></div>` : null}
    ${i === 4 ? html`<div class="stack"><div class="small muted">Enter today's outstanding from your card app. New card purchases you record here are added automatically, and bill payments reduce it.</div>
      <${ItemsEditor} items=${s.cards} setItems=${(v) => set({ cards: v })} schema=${SCHEMAS.cards} blank=${BLANKS.cards} addLabel="Add card" /></div>` : null}
    ${i === 5 ? html`<div class="stack"><div class="small muted">Emergency fund, savings accounts, FDs, mutual funds, stocks. Keep the bank account you spend from out of this list; it is the balance in step 2.</div>
      <${ItemsEditor} items=${s.assets} setItems=${(v) => set({ assets: v })} schema=${SCHEMAS.assets} blank=${BLANKS.assets} addLabel="Add holding" /></div>` : null}
    ${i === 6 ? html`<div class="stack">
      <div class="card stack"><${Field} label="Save every month (target)"><${NumInput} id="su-target" value=${s.savingsTarget.monthly} placeholder="e.g. 15000" onChange=${(v) => set({ savingsTarget: { monthly: v } })} /></${Field}>
        <${Field} label="Safety cushion kept out of Safe to Spend"><${NumInput} id="su-cushion" value=${s.cushion} onChange=${(v) => set({ cushion: v })} /></${Field}></div>
      <span class="lbl">Long-term goals (your notes say ₹3–5 lakh)</span>
      <${ItemsEditor} items=${s.goals} setItems=${(v) => set({ goals: v })} schema=${SCHEMAS.goals} blank=${BLANKS.goals} addLabel="Add goal" /></div>` : null}
    <div class="row">
      ${i > 0 ? html`<button class="btn" onClick=${() => setI(i - 1)}>Back</button>` : null}
      <span class="grow"></span>
      ${i > 0 && i < SETUP_STEPS.length - 1 ? html`<button class="link" onClick=${() => setI(i + 1)}>Skip</button>` : null}
      ${i < SETUP_STEPS.length - 1 ? html`<button class="btn primary" onClick=${() => setI(i + 1)}>${i === 0 ? 'Start' : 'Next'}</button>` : html`<button class="btn primary" onClick=${finish}>Finish setup</button>`}
    </div>
  </div>`;
}

/* ===================== App shell ===================== */
const TABS = [['home', 'Home', 'home'], ['activity', 'Activity', 'list'], ['add', 'Add', 'plus'], ['budgets', 'Budgets', 'budget'], ['health', 'Health', 'health'], ['adviser', 'Adviser', 'spark']];

function App() {
  const { profile, txs, status } = useStore();
  const [tab, setTab] = useState(() => { const h = (location.hash || '').slice(1); return TABS.some((t) => t[0] === h && h !== 'add') ? h : 'home'; });
  const [sheet, setSheet] = useState(null);
  const [settings, setSettings] = useState(false);
  const [resetup, setResetup] = useState(false);
  const [toastEl, toast] = useToast();
  useEffect(() => { const f = () => { const h = location.hash.slice(1); if (TABS.some((t) => t[0] === h && h !== 'add')) setTab(h); }; window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  const go = (t) => { if (t === 'add') { setSheet({}); return; } setTab(t); try { history.replaceState(null, '', '#' + t); } catch (e) { location.hash = t; } window.scrollTo(0, 0); };

  if (!status.loaded) return html`<div class="screen"><div class="topbar"><h1>Finance OS</h1></div>
    <div class="card">${status.stale ? (status.error || 'Your saved data cannot be reached yet. Check your connection; nothing has been changed.') : 'Loading your saved data…'}</div></div>`;

  // Only offer first-run setup once the store has confirmed there is no saved profile.
  if (!profile && !status.confirmed) return html`<div class="screen"><div class="topbar"><h1>Finance OS</h1></div><div class="card">Checking your saved data…</div></div>`;
  if (!profile || !profile.setupDone || resetup) {
    const mirror = !profile && status.mode === 'cloud' ? store.readMirror() : null;
    return html`<${React.Fragment}>
      ${mirror ? html`<div class="screen" style=${{ paddingBottom: 0 }}><div class="banner warn" style=${{ marginTop: '12px' }}><div class="grow">A copy of your data from ${new Date(mirror.at).toLocaleDateString('en-IN')} is still in this browser, but your account store is empty.</div>
        <button class="btn sm" onClick=${() => Promise.all(Object.entries(mirror.docs).map(([k, v]) => store.write(k, v))).then(() => toast('Restored from this device'))}>Restore it</button></div></div>` : null}
      <${Setup} existing=${profile && profile.setupDone ? profile : null} txs=${txs} onCancel=${resetup ? () => setResetup(false) : null}
        onDone=${(out) => saveProfile(out).then(() => { setResetup(false); toast('Setup saved'); }).catch((e) => toast('Not saved: ' + e.code))} />
      ${toastEl}</${React.Fragment}>`;
  }
  const p = Object.assign(C.blankState(), profile);
  const props = { p, txs, toast, status };
  return html`<${React.Fragment}>
    ${status.mode === 'local' && !IS_APP ? html`<div style=${{ paddingInline: 'max(16px, env(safe-area-inset-left, 0px))', paddingTop: '10px' }}><div class="banner bad small">Saved in this browser only, not to your account. Open the app inside Claude for cloud saving, and export backups from Settings.</div></div>` : null}
    ${status.error ? html`<div style=${{ paddingInline: 'max(16px, env(safe-area-inset-left, 0px))', paddingTop: '10px' }}><div class="banner bad small"><div class="grow">${status.error}</div>${status.failedDocs.length ? html`<button class="btn sm" onClick=${() => store.retry()}>Retry</button>` : null}</div></div>` : null}
    ${tab === 'home' ? html`<${Home} ...${props} go=${go} openAdd=${() => setSheet({})} openTx=${(t) => setSheet(t)} openSettings=${() => setSettings(true)} />` : null}
    ${tab === 'activity' ? html`<${Activity} ...${props} openTx=${(t) => setSheet(t)} />` : null}
    ${tab === 'budgets' ? html`<${Budgets} ...${props} />` : null}
    ${tab === 'health' ? html`<${Health} ...${props} openAdd=${(t) => setSheet(t)} />` : null}
    ${tab === 'adviser' ? html`<${Adviser} ...${props} />` : null}
    <nav class="nav" aria-label="Sections"><div class="in">
      ${TABS.map(([k, l, ic]) => k === 'add'
        ? html`<button key=${k} class="add" aria-label="Add transaction" onClick=${() => setSheet({})}><span class="fab"><${Icon} name="plus" /></span></button>`
        : html`<button key=${k} class=${tab === k ? 'on' : ''} aria-current=${tab === k ? 'page' : undefined} onClick=${() => go(k)}><${Icon} name=${ic} />${l}</button>`)}
    </div></nav>
    ${sheet ? html`<${AddSheet} key=${sheet.id || 'new'} p=${p} txs=${txs} initial=${sheet} onClose=${() => setSheet(null)} toast=${toast} />` : null}
    ${settings ? html`<${Settings} ...${props} onClose=${() => setSettings(false)} rerunSetup=${() => { setSettings(false); setResetup(true); }} />` : null}
    ${toastEl}
  </${React.Fragment}>`;
}

applyThemeAttr(lsGet('financeos.theme') || 'system');
ReactDOM.createRoot(document.getElementById('root')).render(html`<${App} />`);
store.start();
