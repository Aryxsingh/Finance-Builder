/* Finance OS — storage, shared components and charts. */
const { useState, useEffect, useMemo, useRef, useCallback } = React;
const html = htm.bind(React.createElement);
const C = window.Core;
const today = () => C.iso(new Date());
const MIRROR_KEY = 'financeos.mirror.v1';
const LOCAL_KEY = 'financeos.local.v1';
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };
const clone = (o) => JSON.parse(JSON.stringify(o));
/** A runtime capability, or null where this view has none (e.g. opened outside Claude). */
const useCap = (name) => (window.claude && window.claude.use ? Promise.resolve(window.claude.use(name)).catch(() => null) : Promise.resolve(null));

/* ===================== Storage =====================
   Cloud mode: the artifact `db`, in this person's private subtree
   data/users/<id>/ — one `profile` doc plus one `tx-YYYY-MM` doc per month.
   Local mode (db unavailable): this browser only, and the app says so. */
function createStore() {
  const listeners = new Set();
  const docs = {};
  const dirty = new Set();
  const queues = {};
  let db = null, uid = null, timer = null;
  const status = { mode: 'starting', loaded: false, confirmed: false, saving: 0, lastSaved: null, error: null, stale: false, failedDocs: [] };
  const emit = () => listeners.forEach((f) => f());

  function mirror() { lsSet(MIRROR_KEY, JSON.stringify({ at: Date.now(), docs })); }

  function lastSavedFromDocs() {
    let m = null;
    for (const d of Object.values(docs)) if (d && d.savedAt && (!m || d.savedAt > m)) m = d.savedAt;
    return m ? new Date(m) : null;
  }

  async function start() {
    let user = null;
    try { db = await useCap('db'); } catch (e) { db = null; }
    try { user = await useCap('user'); } catch (e) { user = null; }
    try { uid = user ? await user.id() : null; } catch (e) { uid = null; }
    if (!db || !uid) return startLocal();
    status.mode = 'cloud';
    timer = setTimeout(() => { status.stale = true; emit(); }, 10000);
    db.collection('data/users/' + uid).onSnapshot((snap) => {
      for (const d of snap.docs) if (!dirty.has(d.id)) docs[d.id] = clone(d.data());
      for (const ch of snap.docChanges()) if (ch.type === 'removed' && !dirty.has(ch.doc.id)) delete docs[ch.doc.id];
      status.loaded = true;
      if (!snap.metadata.fromCache) { status.confirmed = true; status.stale = false; clearTimeout(timer); }
      if (!status.lastSaved) status.lastSaved = lastSavedFromDocs();
      emit();
    }, (e) => {
      clearTimeout(timer);
      status.error = 'Your saved data could not be loaded (' + e.code + '). Nothing has been changed. Reopen the app to try again.';
      status.stale = true; emit();
    });
  }

  function startLocal() {
    status.mode = 'local';
    const raw = lsGet(LOCAL_KEY);
    if (raw) { try { Object.assign(docs, JSON.parse(raw).docs || {}); } catch (e) { status.error = 'The copy saved in this browser is damaged. Import a backup in Settings.'; } }
    status.loaded = true; status.confirmed = true; status.lastSaved = lastSavedFromDocs();
    emit();
  }

  async function setOnce(id, body) {
    try { await db.doc('data/users/' + uid + '/' + id).set(body); }
    catch (e) {
      if (e && e.code === 'unavailable') { await new Promise((r) => setTimeout(r, 600 + Math.random() * 800)); await db.doc('data/users/' + uid + '/' + id).set(body); }
      else throw e;
    }
  }

  async function run(id) {
    const q = queues[id]; q.running = true;
    while (q.pending) {
      const body = q.pending; q.pending = null;
      const waiters = q.waiters; q.waiters = [];
      status.saving++; emit();
      try {
        await setOnce(id, body);
        status.lastSaved = new Date(); status.failedDocs = status.failedDocs.filter((x) => x !== id);
        if (!status.failedDocs.length) status.error = null;
        waiters.forEach((w) => w.res());
      } catch (e) {
        const code = (e && e.code) || 'unknown';
        status.error = code === 'quota_exceeded' ? 'Storage is full. Export a backup, then remove old data.'
          : code === 'invalid_argument' ? 'This account cannot write here (view-only access?). Changes stay on this screen only.'
          : 'Last change was NOT saved (' + code + '). Tap Retry; a copy is kept in this browser meanwhile.';
        if (!status.failedDocs.includes(id)) status.failedDocs.push(id);
        waiters.forEach((w) => w.rej(e));
      }
      status.saving--; emit();
    }
    q.running = false;
    if (!status.failedDocs.includes(id)) dirty.delete(id);
  }

  function write(id, data) {
    const body = Object.assign({}, data, { savedAt: new Date().toISOString() });
    docs[id] = body; dirty.add(id); mirror();
    if (status.mode !== 'cloud') {
      const ok = lsSet(LOCAL_KEY, JSON.stringify({ docs }));
      if (ok) { status.lastSaved = new Date(); status.error = null; }
      else status.error = 'This browser refused to save. Export a JSON backup now.';
      dirty.delete(id); emit();
      return ok ? Promise.resolve() : Promise.reject({ code: 'local_failed' });
    }
    emit();
    const q = queues[id] || (queues[id] = { pending: null, running: false, waiters: [] });
    q.pending = body;
    const p = new Promise((res, rej) => q.waiters.push({ res, rej }));
    if (!q.running) run(id);
    return p;
  }

  function retry() { for (const id of status.failedDocs.slice()) write(id, docs[id]); }

  function readMirror() { try { const m = JSON.parse(lsGet(MIRROR_KEY) || 'null'); return m && m.docs && m.docs.profile ? m : null; } catch (e) { return null; } }

  return {
    start, write, retry, readMirror, status,
    subscribe(f) { listeners.add(f); return () => listeners.delete(f); },
    get docs() { return docs; },
  };
}
const store = createStore();

function useStore() {
  const [, force] = useState(0);
  useEffect(() => store.subscribe(() => force((n) => n + 1)), []);
  const profile = store.docs.profile || null;
  const txs = [];
  for (const [id, d] of Object.entries(store.docs)) if (id.startsWith('tx-') && d && Array.isArray(d.items)) txs.push(...d.items);
  txs.sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
  return { profile, txs, status: store.status };
}

/* Data actions — each one saves immediately. */
const monthDoc = (mk) => store.docs['tx-' + mk] || { items: [] };
function saveProfile(p) { return store.write('profile', p); }
async function saveTx(t, profile) {
  const mk = C.monthKey(t.date);
  const old = findTx(t.id);
  const writes = [];
  if (old && C.monthKey(old.date) !== mk) {
    const om = C.monthKey(old.date);
    writes.push(store.write('tx-' + om, { items: monthDoc(om).items.filter((x) => x.id !== t.id) }));
  }
  const items = monthDoc(mk).items.filter((x) => x.id !== t.id).concat([t]);
  writes.push(store.write('tx-' + mk, { items }));
  // Shared bill: others' share becomes money owed to me.
  if (profile) {
    let lent = (profile.lent || []).slice();
    const i = lent.findIndex((x) => x.txId === t.id);
    if (C.num(t.othersOwe) > 0) {
      const entry = Object.assign({ id: C.uid(), payments: [], expected: '' }, i >= 0 ? lent[i] : {}, { txId: t.id, person: t.owedBy || 'Friends', amount: C.num(t.othersOwe), date: t.date, notes: 'Share of ' + (t.name || t.category) });
      if (i >= 0) lent[i] = entry; else lent.push(entry);
      writes.push(saveProfile(Object.assign({}, profile, { lent })));
    } else if (i >= 0 && !(lent[i].payments || []).length) {
      lent.splice(i, 1); writes.push(saveProfile(Object.assign({}, profile, { lent })));
    }
  }
  return Promise.all(writes);
}
function findTx(id) {
  for (const [k, d] of Object.entries(store.docs)) if (k.startsWith('tx-') && d && d.items) { const t = d.items.find((x) => x.id === id); if (t) return t; }
  return null;
}
function deleteTx(t, profile) {
  const mk = C.monthKey(t.date);
  const w = [store.write('tx-' + mk, { items: monthDoc(mk).items.filter((x) => x.id !== t.id) })];
  if (profile) {
    const lent = (profile.lent || []).filter((x) => !(x.txId === t.id && !(x.payments || []).length));
    if (lent.length !== (profile.lent || []).length) w.push(saveProfile(Object.assign({}, profile, { lent })));
  }
  return Promise.all(w);
}

/* ===================== Small components ===================== */
const ICONS = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  plus: 'M12 5v14M5 12h14',
  budget: 'M12 3v9l7.8 4.5A9 9 0 1 1 12 3zM15 3.5a9 9 0 0 1 5.6 9',
  health: 'M3 12h4l3-8 4 16 3-8h4',
  spark: 'M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  x: 'M6 6l12 12M18 6L6 18',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3',
  send: 'M5 12h14M13 6l6 6-6 6',
};
function Icon({ name }) {
  return html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${ICONS[name]} /></svg>`;
}
const fmt = C.fmt;
const pct = (v) => v == null ? '—' : Math.round(v * 100) + '%';
const shortDate = (s) => s ? C.parse(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—';
const monthName = (mk, long) => C.parse(mk + '-01').toLocaleDateString('en-IN', { month: long ? 'long' : 'short', year: long ? 'numeric' : undefined });
const initials = (s) => (s || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

function Sheet({ title, onClose, children, wide }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return html`<div class="scrim" onClick=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div class="sheet" role="dialog" aria-label=${title}>
      <div class="grab"></div>
      <div class="head"><h3>${title}</h3><button class="iconbtn" aria-label="Close" onClick=${onClose}><${Icon} name="x" /></button></div>
      ${children}
    </div></div>`;
}

function Field({ label, children }) { return html`<div class="field"><label>${label}</label>${children}</div>`; }
function NumInput({ value, onChange, placeholder, id }) {
  return html`<input id=${id} class="input num" inputmode="decimal" placeholder=${placeholder || '0'} value=${value === '' || value == null ? '' : value}
    onChange=${(e) => { const v = e.target.value.replace(/[^\d.]/g, ''); onChange(v === '' ? '' : Number(v)); }} />`;
}
function Seg({ value, options, onChange }) {
  return html`<div class="seg">${options.map((o) => html`<button key=${o.v} class=${value === o.v ? 'on' : ''} onClick=${() => onChange(o.v)}>${o.l}</button>`)}</div>`;
}
function Bar({ value, level }) {
  const cls = level >= 100 ? 'bar bad' : level >= 75 ? 'bar warn' : 'bar';
  return html`<div class=${cls}><i style=${{ width: Math.min(100, Math.max(0, (value || 0) * 100)) + '%' }}></i></div>`;
}
function Pill({ tone, children }) { return html`<span class=${'pill ' + (tone || '')}>${children}</span>`; }

function useToast() {
  const [msg, setMsg] = useState(null);
  const t = useRef();
  const show = useCallback((m) => { setMsg(m); clearTimeout(t.current); t.current = setTimeout(() => setMsg(null), 3200); }, []);
  const el = msg ? html`<div class="toast" role="status">${msg}</div>` : null;
  return [el, show];
}

function TxRow({ t, onClick }) {
  const out = t.type === 'expense';
  return html`<button class="tx" onClick=${onClick}>
    <span class="ic">${initials(t.name || t.category)}</span>
    <span class="grow" style=${{ minWidth: 0 }}>
      <div class="ellipsis" style=${{ fontWeight: 600 }}>${t.name || t.category}</div>
      <div class="small muted ellipsis">${t.category} · ${shortDate(t.date)} · ${t.method}${C.num(t.othersOwe) ? ' · ' + fmt(t.othersOwe) + ' owed to you' : ''}</div>
    </span>
    <span class=${'amt num' + (out ? '' : ' in')}>${out ? '−' : '+'}${fmt(t.amount).replace('−', '')}</span>
  </button>`;
}

/* Generic editor for lists of records (loans, cards, assets, IOUs...). */
function ItemsEditor({ items, setItems, schema, blank, addLabel }) {
  const upd = (i, k, v) => setItems(items.map((x, j) => j === i ? Object.assign({}, x, { [k]: v }) : x));
  return html`<div class="stack">
    ${items.map((it, i) => html`<div class="item" key=${it.id || i}>
      <div class="grid2">
        ${schema.map((f) => html`<div class="field" key=${f.k} style=${{ gridColumn: f.full ? '1 / -1' : undefined }}>
          <label for=${'f-' + (it.id || i) + '-' + f.k}>${f.l}</label>
          ${f.t === 'number' ? html`<${NumInput} id=${'f-' + (it.id || i) + '-' + f.k} value=${it[f.k]} placeholder=${f.ph} onChange=${(v) => upd(i, f.k, v)} />`
          : f.t === 'select' ? html`<select id=${'f-' + (it.id || i) + '-' + f.k} class="input" value=${it[f.k] || ''} onChange=${(e) => upd(i, f.k, e.target.value)}>${f.o.map((o) => html`<option key=${o} value=${o}>${o}</option>`)}</select>`
          : f.t === 'check' ? html`<label class="row small"><input id=${'f-' + (it.id || i) + '-' + f.k} type="checkbox" checked=${!!it[f.k]} onChange=${(e) => upd(i, f.k, e.target.checked)} /> ${f.hint}</label>`
          : html`<input id=${'f-' + (it.id || i) + '-' + f.k} class="input" type=${f.t === 'date' ? 'date' : 'text'} placeholder=${f.ph || ''} value=${it[f.k] || ''} onChange=${(e) => upd(i, f.k, e.target.value)} />`}
        </div>`)}
      </div>
      <button class="link" style=${{ color: 'var(--bad)', alignSelf: 'flex-start' }} onClick=${() => setItems(items.filter((_, j) => j !== i))}>Remove</button>
    </div>`)}
    <button class="btn" onClick=${() => setItems(items.concat([Object.assign({ id: C.uid() }, blank())]))}>+ ${addLabel}</button>
  </div>`;
}

function EditListSheet({ title, items, schema, blank, addLabel, onSave, onClose, note }) {
  const [draft, setDraft] = useState(() => clone(items || []));
  return html`<${Sheet} title=${title} onClose=${onClose}>
    ${note ? html`<div class="small muted">${note}</div>` : null}
    <${ItemsEditor} items=${draft} setItems=${setDraft} schema=${schema} blank=${blank} addLabel=${addLabel} />
    <button class="btn primary block" onClick=${() => { onSave(draft); onClose(); }}>Save</button>
  </${Sheet}>`;
}

const SCHEMAS = {
  loans: [
    { k: 'lender', l: 'Lender', t: 'text', full: true, ph: 'e.g. Bajaj Finance' },
    { k: 'original', l: 'Original amount', t: 'number' }, { k: 'outstanding', l: 'Outstanding principal', t: 'number' },
    { k: 'emi', l: 'Monthly EMI', t: 'number' }, { k: 'rate', l: 'Interest rate % p.a.', t: 'number' },
    { k: 'remainingEmis', l: 'EMIs remaining', t: 'number' }, { k: 'nextDate', l: 'Next EMI date', t: 'date' },
  ],
  cards: [
    { k: 'bank', l: 'Bank / card name', t: 'text', ph: 'HDFC Millennia' }, { k: 'method', l: 'Shows in Add as', t: 'select', o: C.CARD_METHODS },
    { k: 'limit', l: 'Credit limit', t: 'number' }, { k: 'outstanding', l: 'Outstanding now', t: 'number' },
    { k: 'statementDay', l: 'Statement day (1–31)', t: 'number' }, { k: 'dueDay', l: 'Payment due day (1–31)', t: 'number' },
    { k: 'totalDue', l: 'Statement total due', t: 'number' }, { k: 'minDue', l: 'Minimum due', t: 'number' },
  ],
  assets: [
    { k: 'type', l: 'Type', t: 'select', o: C.ASSET_TYPES }, { k: 'name', l: 'Name', t: 'text', ph: 'e.g. SBI savings' },
    { k: 'invested', l: 'Amount invested', t: 'number' }, { k: 'current', l: 'Current value', t: 'number' },
    { k: 'sip', l: 'Monthly SIP / deposit', t: 'number' },
  ],
  fixed: [
    { k: 'name', l: 'Name', t: 'text', ph: 'Rent' }, { k: 'category', l: 'Category', t: 'select', o: C.DEFAULT_CATEGORIES },
    { k: 'amount', l: 'Amount / month', t: 'number' }, { k: 'dueDay', l: 'Due day (1–31)', t: 'number' },
  ],
  goals: [
    { k: 'name', l: 'Goal', t: 'text', full: true, ph: 'Savings goal' }, { k: 'target', l: 'Target', t: 'number' },
    { k: 'saved', l: 'Saved so far', t: 'number' }, { k: 'monthly', l: 'Planned per month (optional)', t: 'number' },
    { k: 'linkNetSavings', l: 'Progress source', t: 'check', hint: 'Use all savings & investments as progress' },
  ],
  lent: [
    { k: 'person', l: 'Person', t: 'text' }, { k: 'amount', l: 'Amount lent', t: 'number' },
    { k: 'date', l: 'Date lent', t: 'date' }, { k: 'expected', l: 'Expected back by', t: 'date' },
    { k: 'notes', l: 'Notes', t: 'text', full: true },
  ],
  borrowed: [
    { k: 'person', l: 'Person / institution', t: 'text' }, { k: 'amount', l: 'Amount owed', t: 'number' },
    { k: 'date', l: 'Date borrowed', t: 'date' }, { k: 'due', l: 'Due date', t: 'date' },
    { k: 'notes', l: 'Notes', t: 'text', full: true },
  ],
  planned: [{ k: 'name', l: 'What', t: 'text' }, { k: 'amount', l: 'Amount', t: 'number' }, { k: 'date', l: 'When', t: 'date' }],
  sources: [{ k: 'name', l: 'Source', t: 'select', o: ['Other income', 'Freelance', 'Bonus', 'From friends', 'Rental', 'Interest'] }, { k: 'amount', l: 'Expected / month', t: 'number' }],
};
const BLANKS = {
  loans: () => ({ lender: '', original: '', outstanding: '', emi: '', rate: '', remainingEmis: '', nextDate: '' }),
  cards: () => ({ bank: '', method: 'HDFC Credit Card', limit: '', outstanding: '', statementDay: '', dueDay: '', totalDue: '', minDue: '' }),
  assets: () => ({ type: 'Mutual funds', name: '', invested: '', current: '', sip: '' }),
  fixed: () => ({ name: '', category: 'Bills & Utilities', amount: '', dueDay: '' }),
  goals: () => ({ name: '', target: '', saved: '', monthly: '', linkNetSavings: false }),
  lent: () => ({ person: '', amount: '', date: today(), expected: '', payments: [] }),
  borrowed: () => ({ person: '', amount: '', date: '', due: '', payments: [] }),
  planned: () => ({ name: '', amount: '', date: '' }),
  sources: () => ({ name: 'Other income', amount: '' }),
};

/* Cards: the editor shows the live outstanding; a changed figure becomes the new baseline from now. */
function cardsForEdit(cards, txs) { return (cards || []).map((c) => Object.assign({}, c, { outstanding: Math.round(C.cardOutstanding(c, txs)) })); }
function cardsFromEdit(draft, cards, txs) {
  return draft.map((d) => {
    const old = (cards || []).find((c) => c.id === d.id);
    if (old && Math.round(C.cardOutstanding(old, txs)) === C.num(d.outstanding)) return Object.assign({}, d, { outstanding: old.outstanding, asOf: old.asOf, asOfTs: old.asOfTs });
    return Object.assign({}, d, { asOf: today(), asOfTs: Date.now() });
  });
}

/* ===================== Charts (SVG, theme tokens) ===================== */
function CashflowChart({ months, onPick, picked }) {
  const W = 340, H = 170, top = 10, bottom = 22, left = 34;
  const max = Math.max(1, ...months.map((m) => Math.max(m.income, m.spend)));
  const nice = niceMax(max);
  const gw = (W - left) / months.length, bw = Math.min(16, gw / 3);
  const y = (v) => top + (H - top - bottom) * (1 - v / nice);
  return html`<svg class="chart" viewBox=${'0 0 ' + W + ' ' + H} role="img" aria-label="Income versus spending by month">
    ${[0, 0.5, 1].map((f) => html`<g key=${f}><line class="grid" x1=${left} x2=${W} y1=${y(nice * f)} y2=${y(nice * f)} /><text x=${left - 6} y=${y(nice * f) + 4} text-anchor="end">${C.fmtShort(nice * f).replace('₹', '')}</text></g>`)}
    ${months.map((m, i) => {
      const x = left + gw * i + gw / 2;
      const on = picked === m.mk;
      return html`<g key=${m.mk} onClick=${() => onPick && onPick(m.mk)} style=${{ cursor: 'pointer' }}>
        <rect x=${left + gw * i} y=${top} width=${gw} height=${H - top - bottom} fill=${on ? 'var(--surface-2)' : 'transparent'} rx="6" />
        <path d=${barPath(x - bw - 1, y(m.income), bw, y(0))} fill="var(--c-income)" />
        <path d=${barPath(x + 1, y(m.spend), bw, y(0))} fill="var(--c-spend)" />
        <text x=${x} y=${H - 6} text-anchor="middle" style=${{ fontWeight: on ? 700 : 400 }}>${monthName(m.mk)}</text>
      </g>`;
    })}
  </svg>`;
}
function barPath(x, yTop, w, yBase) {
  const h = Math.max(0, yBase - yTop); if (h < 0.5) return '';
  const r = Math.min(4, w / 2, h);
  return 'M' + x + ',' + yBase + 'V' + (yTop + r) + 'Q' + x + ',' + yTop + ' ' + (x + r) + ',' + yTop + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + yTop + ' ' + (x + w) + ',' + (yTop + r) + 'V' + yBase + 'Z';
}
function niceMax(v) { const p = Math.pow(10, Math.floor(Math.log10(v))); for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p; return 10 * p; }

function DailyBars({ mk, txs }) {
  const [pick, setPick] = useState(null);
  const d0 = C.parse(mk + '-01'); const n = C.daysInMonth(d0.getFullYear(), d0.getMonth());
  const vals = Array.from({ length: n }, (_, i) => C.sum(txs.filter((t) => C.isSpend(t) && t.date === mk + '-' + String(i + 1).padStart(2, '0')), C.myShare));
  const W = 340, H = 120, top = 6, bottom = 18, left = 2;
  const max = niceMax(Math.max(1, ...vals)); const gw = (W - left) / n; const bw = Math.max(2, gw - 3);
  const y = (v) => top + (H - top - bottom) * (1 - v / max);
  return html`<div class="stack" style=${{ gap: '6px' }}>
    <div class="tip num">${pick != null ? shortDate(mk + '-' + String(pick + 1).padStart(2, '0')) + ': ' + fmt(vals[pick]) : 'Tap a day. Highest: ' + fmt(Math.max(...vals)) + ' · scale to ' + C.fmtShort(max)}</div>
    <svg class="chart" viewBox=${'0 0 ' + W + ' ' + H} role="img" aria-label="Daily spending">
      <line class="grid" x1="0" x2=${W} y1=${y(0)} y2=${y(0)} />
      ${vals.map((v, i) => html`<g key=${i} onClick=${() => setPick(i)}>
        <rect x=${left + gw * i} y=${top} width=${gw} height=${H - top - bottom} fill="transparent" />
        <path d=${barPath(left + gw * i + (gw - bw) / 2, y(v), bw, y(0))} fill=${pick === i ? 'var(--fg)' : 'var(--accent)'} />
      </g>`)}
      ${[1, 8, 15, 22, n].map((d) => html`<text key=${d} x=${left + gw * (d - 1) + gw / 2} y=${H - 4} text-anchor="middle">${d}</text>`)}
    </svg></div>`;
}

function TrendLine({ points }) {
  const [pick, setPick] = useState(points.length - 1);
  const W = 340, H = 130, top = 12, bottom = 22, left = 36;
  const vals = points.map((p) => p.v);
  const hi = Math.max(0, ...vals), lo = Math.min(0, ...vals); const span = (hi - lo) || 1;
  const y = (v) => top + (H - top - bottom) * (1 - (v - lo) / span);
  const x = (i) => left + (W - left - 10) * (points.length === 1 ? 0.5 : i / (points.length - 1));
  const d = points.map((p, i) => (i ? 'L' : 'M') + x(i) + ',' + y(p.v)).join('');
  const p = points[pick];
  return html`<div class="stack" style=${{ gap: '6px' }}>
    <div class="tip num">${p ? monthName(p.mk, true) + ': ' + fmt(p.v, { sign: true }) + (p.rate != null ? ' (' + pct(p.rate) + ' of income)' : '') : ''}</div>
    <svg class="chart" viewBox=${'0 0 ' + W + ' ' + H} role="img" aria-label="Net savings by month">
      <line class="grid" x1=${left} x2=${W} y1=${y(0)} y2=${y(0)} /><text x=${left - 6} y=${y(0) + 4} text-anchor="end">0</text>
      <text x=${left - 6} y=${y(hi) + 4} text-anchor="end">${C.fmtShort(hi).replace('₹', '')}</text>
      ${lo < 0 ? html`<text x=${left - 6} y=${y(lo) + 4} text-anchor="end">${C.fmtShort(lo).replace('₹', '')}</text>` : null}
      <path d=${d} fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" />
      ${points.map((pt, i) => html`<g key=${pt.mk} onClick=${() => setPick(i)} style=${{ cursor: 'pointer' }}>
        <rect x=${x(i) - 20} y=${top} width="40" height=${H - top - bottom} fill="transparent" />
        <circle cx=${x(i)} cy=${y(pt.v)} r=${i === pick ? 5 : 4} fill=${pt.v < 0 ? 'var(--bad)' : 'var(--accent)'} stroke="var(--surface)" stroke-width="2" />
        <text x=${x(i)} y=${H - 5} text-anchor="middle">${monthName(pt.mk)}</text>
      </g>`)}
    </svg></div>`;
}

function HBars({ rows, total, limit, empty }) {
  const list = rows.slice(0, limit || 8); const max = Math.max(1, ...list.map((r) => r.v));
  if (!list.length) return html`<div class="empty">${empty || 'Nothing recorded yet.'}</div>`;
  return html`<div class="stack">${list.map((r) => html`<div key=${r.k} class="stack" style=${{ gap: '5px' }}>
    <div class="row small"><span class="grow ellipsis" style=${{ fontWeight: 600 }}>${r.k}</span><span class="num">${fmt(r.v)}</span><span class="muted num" style=${{ width: '38px', textAlign: 'right' }}>${total ? Math.round(r.v / total * 100) + '%' : ''}</span></div>
    <div class="bar"><i style=${{ width: (r.v / max * 100) + '%' }}></i></div>
  </div>`)}</div>`;
}
