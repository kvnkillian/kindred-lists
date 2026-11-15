/* Kindred Lists — Firebase edition.
 * Syncs across devices with Cloud Firestore (Firebase project
 * "kindred-lists", Spark plan). No account: the app signs in
 * anonymously in the background. No ads, no analytics, no tracking.
 * Security comes from firestore.rules — claimer names live only in
 * claim documents that only their claimer can read; items carry only
 * a taken flag, never a name.
 * If Firebase can't load or anonymous sign-in fails (e.g. blocked
 * network), the app falls back to the original localStorage mode and
 * says so in the UI. The Firebase SDK is loaded from Google's CDN
 * with dynamic import() — no build step, no npm. */
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCSkT5cMjMPQ9Abr1kNUvzS_w0Uro8ERAA',
  authDomain: 'kindred-lists.firebaseapp.com',
  projectId: 'kindred-lists',
  storageBucket: 'kindred-lists.firebasestorage.app',
  messagingSenderId: '330930998358',
  appId: '1:330930998358:web:b393ac49587d983f017ff7',
};
const FIREBASE_VERSION = '10.12.2';
const FAMILY_PARAM = 'family';
const DEFAULT_FAMILY = 'killian-christmas-2026';
const TAKEN = '\u0000taken'; // sentinel: item taken by someone else (name hidden)
const PREFS_KEY = 'kindred-lists-prefs-v1';
const LEGACY_KEY = 'kindred-lists-v1';
const $ = (s) => document.querySelector(s);

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const money = (n) => '$' + (Number(n) || 0).toFixed(2).replace(/\.00$/, '');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const wantedLabel = (w) => ({ 3: 'Really want it', 2: 'Would love it', 1: 'Nice to have' }[w] || 'Would love it');

const familyId = (() => {
  const p = new URLSearchParams(location.search).get(FAMILY_PARAM) || '';
  const clean = p.trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 64);
  return clean || DEFAULT_FAMILY;
})();

/* ---- per-device prefs (gifter name, view, Santa reveals) ---- */
function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return { gifterName: p.gifterName || '', view: p.view || 'owner', revealed: p.revealed || {} };
    }
  } catch { /* fall through */ }
  // Migrate from the old localStorage state, if present.
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (raw) {
      const old = JSON.parse(raw);
      return { gifterName: old.gifterName || '', view: old.view || 'owner', revealed: (old.santa && old.santa.revealed) || {} };
    }
  } catch { /* fall through */ }
  return { gifterName: '', view: 'owner', revealed: {} };
}
const prefs = loadPrefs();
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* private mode: keep in-memory */ }
}

/* ---- seed data (demo lists) ---- */
function seedLists() {
  return [
    {
      id: 'alex', person: 'Alex', occasion: 'Christmas 2026', budget: 200,
      isChild: false, managedBy: '',
      items: [
        { id: uid(), name: 'Kindle Paperwhite', link: 'https://www.amazon.com/dp/B0C75RBY21', price: 149.99, details: '16GB, Agave Green', wanted: 3, familyOnly: false, claimedBy: '', bought: false, taken: false },
        { id: uid(), name: 'Cozy throw blanket', link: '', price: 45, details: 'Cream, washable', wanted: 2, familyOnly: false, claimedBy: '', bought: false, taken: false },
      ],
    },
    {
      id: 'kevin', person: 'Kevin', occasion: 'Christmas 2026', budget: 150,
      isChild: false, managedBy: '',
      items: [
        { id: uid(), name: 'Pour-over coffee set', link: '', price: 38, details: 'Dripper + filters', wanted: 2, familyOnly: false, claimedBy: '', bought: false, taken: false },
      ],
    },
    {
      id: 'baby', person: 'Baby', occasion: 'Christmas 2026 · First Christmas', budget: 100,
      isChild: true, managedBy: 'Alex & Kevin',
      items: [
        { id: uid(), name: 'High-contrast board book', link: '', price: 12, details: 'Black-and-white, 0–6 months', wanted: 3, familyOnly: false, claimedBy: '', bought: false, taken: false },
        { id: uid(), name: 'Soft plush rattle', link: '', price: 18, details: 'Machine washable', wanted: 2, familyOnly: true, claimedBy: '', bought: false, taken: false },
      ],
    },
  ];
}
function defaultSanta() {
  return {
    participants: ['Alex', 'Kevin', 'Emma', 'Mark'],
    exclusions: [['Alex', 'Kevin']],
    lastYear: { Kevin: 'Emma', Alex: 'Mark', Emma: 'Kevin', Mark: 'Alex' },
    draw: {}, // giver -> recipient
  };
}

/* ---- in-memory state (renderers read this, in both modes) ---- */
let state = {
  view: prefs.view,
  gifterName: prefs.gifterName,
  lists: [], // {id, person, occasion, budget, isChild, managedBy, ownerUid, items: [...]}
  santa: defaultSanta(),
  revealed: prefs.revealed, // giver -> true once they tap to reveal (this device only)
  claimsMine: {}, // firebase mode: itemId -> claim {listId, claimerName, bought}
};
let mode = 'firebase'; // 'firebase' | 'local'
let myUid = null;
let db = null;
let F = null; // firebase/firestore module namespace (dynamic import)
let giftFormOpen = false;
let currentListId = null;
let historyStack = ['home']; // one back button goes back one screen
let seedDone = false;
let seeding = false;
let hasSynced = false;

function findList(id) { return state.lists.find((l) => l.id === id); }
function findItem(listId, itemId) {
  const list = findList(listId);
  return list && list.items.find((i) => i.id === itemId);
}
function claimedTotal(list) {
  return list.items.filter((i) => i.claimedBy).reduce((s, i) => s + (Number(i.price) || 0), 0);
}
/* In firebase mode a list can only be edited by the browser that created it
 * (rules enforce ownerUid). In local mode everything is editable. */
function canEdit(list) {
  return mode === 'local' || !list || !list.ownerUid || list.ownerUid === myUid;
}
function denyAlert() {
  alert('Only the device that created this list can edit it. Lists are owned by the browser that created them.');
}

/* ---- sync status line ---- */
function setSyncStatus(kind) {
  const el = $('#syncStatus');
  if (!el) return;
  const text = {
    connecting: 'Connecting to sync…',
    synced: 'Synced — reservations update live on every device.',
    offline: 'You’re offline — changes are saved on this device and will sync when you’re back online.',
    local: 'Sync unavailable — stored on this device only.',
  }[kind] || '';
  el.textContent = text;
  el.dataset.state = kind;
}
function updateSyncStatus(metadata) {
  if (!metadata) return;
  if (metadata.fromCache) {
    if (hasSynced) setSyncStatus('offline');
  } else {
    hasSynced = true;
    setSyncStatus('synced');
  }
}

/* ---- navigation: one back button, back one screen ---- */
function show(view) {
  document.querySelectorAll('.view').forEach((v) => { v.hidden = true; });
  const el = document.getElementById('view-' + view);
  if (el) el.hidden = false;
  $('#backBtn').hidden = historyStack.length <= 1;
  window.scrollTo(0, 0);
}
function go(view) {
  if (view === 'list') { giftFormOpen = false; $('#giftForm').hidden = true; }
  historyStack.push(view);
  render();
  show(view);
}
function goBack() {
  if (historyStack.length <= 1) return;
  historyStack.pop();
  giftFormOpen = false;
  render();
  show(historyStack[historyStack.length - 1]);
}
$('#backBtn').addEventListener('click', goBack);

/* ---- view switcher: Owner vs Family ---- */
function setView(v) {
  state.view = v;
  prefs.view = v;
  savePrefs();
  if (mode === 'local') saveLocal();
  $('#ownerBtn').setAttribute('aria-pressed', String(v === 'owner'));
  $('#familyBtn').setAttribute('aria-pressed', String(v === 'family'));
  $('#viewHint').textContent = v === 'owner'
    ? 'Owners add and edit gifts. Owners never see who claimed what.'
    : 'Gifters reserve under their name. Reserved gifts show as taken to other gifters.';
  render();
}
$('#ownerBtn').addEventListener('click', () => setView('owner'));
$('#familyBtn').addEventListener('click', () => setView('family'));

/* ---- renderers ---- */
function render() {
  setViewButtons();
  renderHome();
  if (currentListId) renderList();
  renderSanta();
  renderGiving();
}
function setViewButtons() {
  $('#ownerBtn').setAttribute('aria-pressed', String(state.view === 'owner'));
  $('#familyBtn').setAttribute('aria-pressed', String(state.view === 'family'));
}

function renderHome() {
  const grid = $('#listGrid');
  const empty = $('#homeEmpty');
  empty.hidden = state.lists.length > 0;
  grid.innerHTML = state.lists.map((list) => {
    const claimed = claimedTotal(list);
    const open = list.items.filter((i) => !i.claimedBy).length;
    return `<button type="button" class="list-card" data-open-list="${esc(list.id)}"
        aria-label="Open ${esc(list.person)}'s list, ${open} gifts still open, ${money(claimed)} claimed of ${money(list.budget)} budget">
      <h3>${esc(list.person)}${list.isChild ? '<span class="badge">Child list</span>' : ''}</h3>
      <p class="sub">${esc(list.occasion || 'Wishlist')}${list.isChild && list.managedBy ? ' · Kept by ' + esc(list.managedBy) : ''}</p>
      <p class="counts">${list.items.length} gift${list.items.length === 1 ? '' : 's'} · ${open} still open · ${money(claimed)} claimed of ${money(list.budget)} budget</p>
    </button>`;
  }).join('');
}

function renderList() {
  const list = findList(currentListId);
  if (!list) { currentListId = null; return; }
  const editable = canEdit(list);
  $('#listHeading').textContent = list.person + (list.isChild ? ' — child list' : '');
  $('#listMeta').textContent = (list.occasion || 'Wishlist')
    + (list.isChild && list.managedBy ? ' · Kept by ' + list.managedBy : '')
    + ' · Budget ' + money(list.budget) + ' per person';
  const editNote = $('#editNote');
  if (editNote) {
    editNote.hidden = !(mode === 'firebase' && state.view === 'owner' && !editable);
    editNote.textContent = 'This list was created on another device — only that device can edit it.';
  }
  const claimed = claimedTotal(list);
  const budget = Number(list.budget) || 0;
  const pct = budget > 0 ? Math.min(100, Math.round((claimed / budget) * 100)) : 0;
  $('#budgetText').textContent = money(claimed) + ' claimed so far' + (budget > 0 && claimed > budget ? ' · ' + money(claimed - budget) + ' over' : '');
  $('#budgetPct').textContent = budget > 0 ? pct + '% of budget' : '';
  const bar = $('#budgetBar');
  bar.setAttribute('aria-valuenow', String(pct));
  bar.classList.toggle('over', budget > 0 && claimed > budget);
  $('#budgetFill').style.width = pct + '%';

  const visible = list.items.filter((i) => state.view === 'owner' || !i.familyOnly);
  $('#listEmpty').hidden = visible.length > 0;
  $('#addGiftBtn').hidden = state.view !== 'owner' || !editable;
  $('#deleteListBtn').hidden = state.view !== 'owner' || !editable;
  // Never close the gift form under the user while they are filling it in —
  // remote sync snapshots re-render constantly in firebase mode.
  if (!giftFormOpen) $('#giftForm').hidden = true;

  $('#itemList').innerHTML = visible.map((item) => {
    const isClaimed = Boolean(item.claimedBy);
    const mine = state.view === 'family' && item.claimedBy === state.gifterName && state.gifterName;
    let status = '';
    if (state.view === 'owner') {
      // Owner view never renders a claimer name — taken items show only
      // "Reserved — name hidden". (In firebase mode the name isn't even
      // on the item; it lives in a claim doc only its claimer can read.)
      status = isClaimed ? '<p class="claimed">Reserved — name hidden to keep the surprise</p>' : '<p>Still open</p>';
    } else {
      status = isClaimed
        ? (mine
          ? '<p class="claimed">You reserved this' + (item.bought ? ' · Bought ✓' : '') + '</p>'
          : '<p class="claimed">Taken — reserved by someone else</p>')
        : '<p>Still open</p>';
    }
    const actions = state.view === 'owner'
      ? (editable
        ? `<button type="button" class="btn" data-edit-item="${item.id}">Edit</button>
           <button type="button" class="btn danger" data-delete-item="${item.id}">Remove</button>`
        : '')
      : (!isClaimed
        ? `<button type="button" class="btn primary" data-claim-item="${item.id}">Reserve this gift</button>`
        : (mine
          ? `<button type="button" class="btn" data-bought-item="${item.id}">${item.bought ? 'Mark as not bought' : 'Mark as bought'}</button>
             <button type="button" class="btn" data-release-item="${item.id}">Release</button>`
          : ''));
    return `<article class="item-card" aria-label="${esc(item.name)}">
      <h3>${esc(item.name)} ${item.familyOnly ? '<span class="badge">Family only</span>' : ''}</h3>
      ${item.link ? `<p><a href="${esc(item.link)}" target="_blank" rel="noopener">View at store</a></p>` : ''}
      <p class="price">${money(item.price)}</p>
      ${item.details ? `<p>${esc(item.details)}</p>` : ''}
      <p>${esc(wantedLabel(item.wanted))}</p>
      ${status}
      <div class="item-actions">${actions}</div>
    </article>`;
  }).join('');
}

function renderSanta() {
  const s = state.santa;
  // Don't overwrite a textarea while the user is typing in it — remote
  // sync snapshots re-render constantly in firebase mode.
  const active = document.activeElement;
  if (active !== $('#santaPeople')) $('#santaPeople').value = s.participants.join('\n');
  if (active !== $('#santaExclusions')) $('#santaExclusions').value = s.exclusions.map((p) => p.join(', ')).join('\n');
  if (active !== $('#santaLastYear')) $('#santaLastYear').value = Object.entries(s.lastYear).map(([g, r]) => g + ' -> ' + r).join('\n');
  const hasDraw = Object.keys(s.draw).length > 0;
  $('#santaStatus').textContent = hasDraw
    ? 'Draw complete. Each person taps their own name to reveal their match — matches are not shown to anyone else.'
    : 'No draw yet. Add participants, then draw names.';
  $('#santaResults').innerHTML = hasDraw ? s.participants.map((giver) => {
    const revealed = state.revealed[giver];
    const recipient = s.draw[giver];
    return `<li><span><strong>${esc(giver)}</strong> → ${revealed ? '<strong>' + esc(recipient) + '</strong>' : '??? (tap to reveal)'}</span>
      <button type="button" class="btn" data-reveal-santa="${esc(giver)}" aria-label="Reveal ${esc(giver)}'s match">${revealed ? 'Hide' : 'Reveal my match'}</button></li>`;
  }).join('') : '';
}

function renderGiving() {
  if (mode === 'firebase') {
    const mine = Object.values(state.claimsMine).map((claim) => {
      const list = findList(claim.listId);
      const item = list && list.items.find((i) => i.id === claim.itemId);
      return item ? { list, item, claim } : null;
    }).filter(Boolean);
    const reserved = mine.reduce((s, m) => s + (Number(m.item.price) || 0), 0);
    const bought = mine.filter((m) => m.claim.bought).reduce((s, m) => s + (Number(m.item.price) || 0), 0);
    $('#givingTotals').textContent = mine.length
      ? mine.length + ' gift' + (mine.length === 1 ? '' : 's') + ' reserved · ' + money(reserved) + ' reserved · ' + money(bought) + ' already bought'
        + (state.gifterName ? ' · as ' + state.gifterName : '')
      : 'Nothing reserved yet.';
    $('#givingEmpty').hidden = mine.length > 0;
    $('#givingList').innerHTML = mine.map(({ list, item, claim }) => `<article class="item-card">
      <h3>${esc(item.name)}</h3>
      <p>For ${esc(list.person)} · ${money(item.price)} · Reserved by you${claim.bought ? ' · Bought ✓' : ''}</p>
      <div class="item-actions">
        <button type="button" class="btn" data-bought-item="${item.id}" data-list-id="${list.id}">${claim.bought ? 'Mark as not bought' : 'Mark as bought'}</button>
        <button type="button" class="btn" data-release-item="${item.id}" data-list-id="${list.id}">Release</button>
      </div>
    </article>`).join('');
    return;
  }
  const mine = [];
  state.lists.forEach((list) => {
    list.items.forEach((item) => {
      if (item.claimedBy && (!state.gifterName || item.claimedBy === state.gifterName)) {
        mine.push({ list, item });
      }
    });
  });
  const reserved = mine.reduce((s, m) => s + (Number(m.item.price) || 0), 0);
  const bought = mine.filter((m) => m.item.bought).reduce((s, m) => s + (Number(m.item.price) || 0), 0);
  $('#givingTotals').textContent = mine.length
    ? mine.length + ' gift' + (mine.length === 1 ? '' : 's') + ' reserved · ' + money(reserved) + ' reserved · ' + money(bought) + ' already bought'
      + (state.gifterName ? ' · as ' + state.gifterName : '')
    : 'Nothing reserved yet.';
  $('#givingEmpty').hidden = mine.length > 0;
  $('#givingList').innerHTML = mine.map(({ list, item }) => `<article class="item-card">
    <h3>${esc(item.name)}</h3>
    <p>For ${esc(list.person)} · ${money(item.price)} · Reserved by ${esc(item.claimedBy)}${item.bought ? ' · Bought ✓' : ''}</p>
    <div class="item-actions">
      <button type="button" class="btn" data-bought-item="${item.id}" data-list-id="${list.id}">${item.bought ? 'Mark as not bought' : 'Mark as bought'}</button>
      <button type="button" class="btn" data-release-item="${item.id}" data-list-id="${list.id}">Release</button>
    </div>
  </article>`).join('');
}

/* ---- local mode: original localStorage persistence ---- */
function loadLocal() {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.lists) && parsed.santa) {
        state.lists = parsed.lists;
        state.santa = parsed.santa;
        return;
      }
    }
  } catch { /* fall through to seed */ }
  state.lists = seedLists();
  state.santa = defaultSanta();
}
function saveLocal() {
  try {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({
      gifterName: state.gifterName, view: state.view, lists: state.lists, santa: state.santa,
    }));
  } catch { /* storage full / private mode: keep in-memory */ }
}

/* ---- firebase mode: Firestore refs ---- */
const listsCol = () => F.collection(db, 'families', familyId, 'lists');
const listDoc = (id) => F.doc(db, 'families', familyId, 'lists', id);
const itemsCol = (listId) => F.collection(db, 'families', familyId, 'lists', listId, 'items');
const itemDoc = (listId, itemId) => F.doc(db, 'families', familyId, 'lists', listId, 'items', itemId);
const claimsCol = () => F.collection(db, 'families', familyId, 'claims');
const claimDoc = (itemId) => F.doc(db, 'families', familyId, 'claims', itemId);
const santaDoc = () => F.doc(db, 'families', familyId, 'santa', 'draw');
const seedMarkerDoc = () => F.doc(db, 'families', familyId, 'meta', 'seed');

/* Raw Firestore snapshots, kept apart from the rendered state so a
 * snapshot can rebuild state without clobbering UI state. */
const rawLists = new Map(); // listId -> list doc data
const rawItems = new Map(); // listId -> [item doc data]
const itemUnsubs = new Map(); // listId -> unsubscribe

function rebuildState() {
  state.lists = [...rawLists.values()].map((list) => ({
    ...list,
    items: (rawItems.get(list.id) || []).map((item) => {
      const mine = state.claimsMine[item.id];
      return {
        ...item,
        // My claims show my name; anyone else's claim shows only the
        // TAKEN sentinel — the name is never on the item, in any view.
        claimedBy: mine ? mine.claimerName : (item.taken ? TAKEN : ''),
        bought: mine ? !!mine.bought : false,
      };
    }),
  }));
  render();
}

function subscribeLists() {
  F.onSnapshot(listsCol(), { includeMetadataChanges: true }, (snap) => {
    updateSyncStatus(snap.metadata);
    snap.docChanges().forEach((ch) => {
      if (ch.type === 'removed') {
        rawLists.delete(ch.doc.id);
        rawItems.delete(ch.doc.id);
        const unsub = itemUnsubs.get(ch.doc.id);
        if (unsub) { unsub(); itemUnsubs.delete(ch.doc.id); }
      } else {
        rawLists.set(ch.doc.id, { id: ch.doc.id, ...ch.doc.data() });
        if (!itemUnsubs.has(ch.doc.id)) {
          itemUnsubs.set(ch.doc.id, subscribeItems(ch.doc.id));
        }
      }
    });
    if (snap.empty && !seedDone) maybeSeed();
    rebuildState();
  }, (err) => {
    console.warn('lists listener failed', err);
    setSyncStatus('offline');
  });
}
function subscribeItems(listId) {
  return F.onSnapshot(itemsCol(listId), (snap) => {
    rawItems.set(listId, snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    rebuildState();
  }, (err) => console.warn('items listener failed', err));
}
function subscribeClaims() {
  // Rules let a user read only their own claim docs, so the query must
  // be scoped to my uid — Firestore rules are not filters.
  const q = F.query(claimsCol(), F.where('claimerUid', '==', myUid));
  F.onSnapshot(q, (snap) => {
    const next = {};
    snap.docs.forEach((d) => { next[d.id] = { id: d.id, ...d.data() }; });
    state.claimsMine = next;
    rebuildState();
  }, (err) => console.warn('claims listener failed', err));
}
function subscribeSanta() {
  F.onSnapshot(santaDoc(), (snap) => {
    if (snap.exists()) {
      const d = snap.data();
      state.santa = {
        participants: d.participants || [],
        exclusions: d.exclusions || [],
        lastYear: d.lastYear || {},
        draw: d.draw || {},
      };
    } else {
      state.santa = defaultSanta();
    }
    renderSanta();
  }, (err) => console.warn('santa listener failed', err));
}

/* Seed the demo lists once, when a family has no lists yet. A meta
 * marker doc inside a transaction makes concurrent first loads from
 * two devices safe — only the winner writes the seed. */
async function maybeSeed() {
  if (seeding || seedDone) return;
  seeding = true;
  try {
    const listsSnap = await F.getDocs(listsCol());
    if (!listsSnap.empty) { seedDone = true; return; }
    await F.runTransaction(db, async (tx) => {
      const marker = await tx.get(seedMarkerDoc());
      if (marker.exists()) { seedDone = true; return; }
      for (const list of seedLists()) {
        const { items, ...listData } = list;
        tx.set(listDoc(list.id), {
          ...listData, ownerUid: myUid, ownerName: state.gifterName || '',
          createdAt: F.serverTimestamp(),
        });
        for (const item of items) {
          tx.set(itemDoc(list.id, item.id), { ...item, taken: false, familyId });
        }
      }
      tx.set(seedMarkerDoc(), { seededAt: F.serverTimestamp(), seededBy: myUid });
    });
    seedDone = true;
  } catch (err) {
    // Offline at first load: leave seedDone false so the next snapshot
    // (when the device is back online) retries the seed.
    console.warn('seed skipped for now', err);
  } finally {
    seeding = false;
  }
}

/* ---- gifter name (asked once, remembered on this device) ---- */
function askGifterName() {
  if (state.gifterName) return state.gifterName;
  const name = prompt('Your name, so other gifters see this gift is taken (the owner never sees it):');
  if (!name) return '';
  state.gifterName = name.trim();
  prefs.gifterName = state.gifterName;
  savePrefs();
  if (mode === 'local') saveLocal();
  return state.gifterName;
}

/* ---- claims ---- */
async function claimItem(itemId, listId) {
  const lid = listId || currentListId;
  const list = findList(lid);
  if (!list) return;
  if (mode === 'local') {
    const name = askGifterName();
    if (!name) return;
    const item = list.items.find((i) => i.id === itemId);
    if (!item || item.claimedBy) return;
    item.claimedBy = name; item.bought = false; saveLocal(); render();
    alert('You reserved “' + item.name + '” for ' + list.person + '. The owner will not see your name.');
    return;
  }
  const name = askGifterName();
  if (!name) return;
  try {
    await F.runTransaction(db, async (tx) => {
      const ref = itemDoc(lid, itemId);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('missing');
      // The transaction re-reads on contention, so a second claimer
      // racing this one sees taken=true and aborts here.
      if (snap.data().taken) throw new Error('taken');
      tx.set(claimDoc(itemId), {
        itemId, listId: lid, ownerUid: list.ownerUid || '',
        claimerUid: myUid, claimerName: name, bought: false,
        createdAt: F.serverTimestamp(),
      });
      tx.update(ref, { taken: true });
    });
    const item = findItem(lid, itemId);
    alert('You reserved “' + (item ? item.name : 'this gift') + '” for ' + list.person + '. The owner will not see your name.');
  } catch (err) {
    if (err && err.message === 'taken') alert('Sorry — someone just reserved this gift. It now shows as taken.');
    else if (err && err.code === 'permission-denied') alert('Could not reserve right now (permission denied). Check that the Firestore rules are published.');
    else alert('Could not reserve right now. Check your connection and try again.');
  }
}
async function releaseItem(itemId, listId) {
  const lid = listId || currentListId;
  const list = findList(lid);
  if (!list) return;
  if (mode === 'local') {
    const item = list.items.find((i) => i.id === itemId);
    if (item) { item.claimedBy = ''; item.bought = false; saveLocal(); render(); }
    return;
  }
  try {
    await F.runTransaction(db, async (tx) => {
      const cSnap = await tx.get(claimDoc(itemId));
      if (cSnap.exists()) tx.delete(claimDoc(itemId));
      tx.update(itemDoc(lid, itemId), { taken: false });
    });
  } catch (err) {
    alert('Could not release right now. Check your connection and try again.');
  }
}
async function toggleBought(itemId, listId) {
  const lid = listId || currentListId;
  const list = findList(lid);
  if (!list) return;
  if (mode === 'local') {
    const item = list.items.find((i) => i.id === itemId);
    if (item) { item.bought = !item.bought; saveLocal(); render(); }
    return;
  }
  const claim = state.claimsMine[itemId];
  if (!claim) return;
  try {
    await F.updateDoc(claimDoc(itemId), { bought: !claim.bought });
  } catch (err) {
    alert('Could not update right now. Check your connection and try again.');
  }
}

/* ---- gifts and lists ---- */
function deleteItem(itemId) {
  const list = findList(currentListId);
  if (!list) return;
  if (!confirm('Remove this gift from the list?')) return;
  if (mode === 'local') {
    list.items = list.items.filter((i) => i.id !== itemId);
    saveLocal(); render();
    return;
  }
  if (!canEdit(list)) { denyAlert(); return; }
  (async () => {
    try {
      if (state.claimsMine[itemId]) await F.deleteDoc(claimDoc(itemId)).catch(() => {});
      await F.deleteDoc(itemDoc(list.id, itemId));
    } catch (err) {
      alert('Could not remove right now. Check your connection and try again.');
    }
  })();
}
function editItem(itemId) {
  const list = findList(currentListId);
  const item = list && list.items.find((i) => i.id === itemId);
  if (!item) return;
  const form = $('#giftForm');
  giftFormOpen = true;
  form.hidden = false;
  form.dataset.editing = itemId;
  $('#giftFormHeading').textContent = 'Edit gift';
  $('#giftName').value = item.name;
  $('#giftLink').value = item.link || '';
  $('#giftPrice').value = item.price ?? '';
  $('#giftDetails').value = item.details || '';
  $('#giftWanted').value = String(item.wanted || 2);
  $('#giftFamilyOnly').checked = Boolean(item.familyOnly);
  $('#giftName').focus();
}

/* ---- global clicks (delegation keeps whole-box rows actionable) ---- */
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-action], [data-open-list], [data-claim-item], [data-release-item], [data-bought-item], [data-edit-item], [data-delete-item], [data-reveal-santa]');
  if (!t) return;

  if (t.dataset.openList) { currentListId = t.dataset.openList; go('list'); return; }
  if (t.dataset.claimItem) { claimItem(t.dataset.claimItem, t.dataset.listId); return; }
  if (t.dataset.releaseItem) { releaseItem(t.dataset.releaseItem, t.dataset.listId); return; }
  if (t.dataset.boughtItem) { toggleBought(t.dataset.boughtItem, t.dataset.listId); return; }
  if (t.dataset.deleteItem) { deleteItem(t.dataset.deleteItem); return; }
  if (t.dataset.editItem) { editItem(t.dataset.editItem); return; }
  if (t.dataset.revealSanta) {
    const g = t.dataset.revealSanta;
    state.revealed[g] = !state.revealed[g];
    prefs.revealed = state.revealed;
    savePrefs();
    if (mode === 'local') saveLocal();
    renderSanta();
    return;
  }

  const action = t.dataset.action;
  if (!action) return;
  if (action === 'new-list') go('new-list');
  if (action === 'go-santa') go('santa');
  if (action === 'go-giving') go('giving');
  if (action === 'cancel-new-list') goBack();
  if (action === 'cancel-gift') { giftFormOpen = false; $('#giftForm').hidden = true; }
  if (action === 'add-gift') {
    giftFormOpen = true;
    $('#giftForm').hidden = false;
    $('#giftFormHeading').textContent = 'Add a gift';
    $('#giftForm').dataset.editing = '';
    $('#giftForm').reset();
    $('#giftName').focus();
  }
  if (action === 'share-list') {
    const list = findList(currentListId);
    const url = location.origin + location.pathname + '?family=' + encodeURIComponent(familyId);
    const text = 'Kindred Lists — ' + (list ? list.person + "'s list" : 'our family lists') + ': ' + url
      + (mode === 'local'
        ? ' (opens on this device only — sync is unavailable right now)'
        : ' — open the link, no account needed, tap Reserve to claim a gift');
    const note = $('#shareNote');
    note.hidden = false;
    note.textContent = 'Invite note ready to copy: ' + text;
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
  }
  if (action === 'delete-list') {
    const list = findList(currentListId);
    if (!list) return;
    if (mode === 'firebase' && !canEdit(list)) { denyAlert(); return; }
    if (confirm('Delete ' + list.person + "'s list? This can't be undone.")) {
      if (mode === 'local') {
        state.lists = state.lists.filter((l) => l.id !== list.id);
        currentListId = null; saveLocal(); historyStack = ['home']; render(); show('home');
      } else {
        (async () => {
          try {
            const itemsSnap = await F.getDocs(itemsCol(list.id));
            const batch = F.writeBatch(db);
            itemsSnap.docs.forEach((d) => batch.delete(d.ref));
            batch.delete(listDoc(list.id));
            await batch.commit();
            for (const [itemId, claim] of Object.entries(state.claimsMine)) {
              if (claim.listId === list.id) { try { await F.deleteDoc(claimDoc(itemId)); } catch {} }
            }
            currentListId = null; historyStack = ['home']; render(); show('home');
          } catch (err) {
            alert('Could not delete right now. Check your connection and try again.');
          }
        })();
      }
    }
  }
  if (action === 'clear-santa') {
    if (mode === 'local') {
      state.santa.draw = {}; state.santa.revealed = {}; saveLocal(); renderSanta();
    } else {
      (async () => {
        try { await F.setDoc(santaDoc(), { draw: {} }, { merge: true }); }
        catch (err) { alert('Could not clear the draw right now. Check your connection and try again.'); }
      })();
    }
    state.revealed = {};
    prefs.revealed = {};
    savePrefs();
  }
  if (action === 'reset-demo') {
    if (confirm('Reset all lists and the Secret Santa draw to the example data? Your edits will be lost.')) {
      if (mode === 'local') {
        state.lists = seedLists();
        state.santa = defaultSanta();
        state.revealed = {};
        prefs.revealed = {};
        savePrefs();
        currentListId = null; historyStack = ['home']; saveLocal(); render(); show('home');
      } else {
        resetFirebaseDemo();
      }
    }
  }
});

/* Reset in firebase mode is best-effort: rules only let a device delete
 * lists it created, so lists created on another device are left alone
 * and named in the summary. Demo lists that are missing are re-seeded. */
async function resetFirebaseDemo() {
  const kept = [];
  for (const list of [...state.lists]) {
    if (!canEdit(list)) { kept.push(list.person); continue; }
    try {
      const itemsSnap = await F.getDocs(itemsCol(list.id));
      const batch = F.writeBatch(db);
      itemsSnap.docs.forEach((d) => batch.delete(d.ref));
      batch.delete(listDoc(list.id));
      await batch.commit();
    } catch { /* leave it; the snapshot will show what remains */ }
  }
  for (const [itemId, claim] of Object.entries(state.claimsMine)) {
    try { await F.deleteDoc(claimDoc(itemId)); } catch {}
  }
  try { await F.setDoc(santaDoc(), { draw: {} }, { merge: true }); } catch {}
  for (const list of seedLists()) {
    if (kept.includes(list.person)) continue;
    try {
      const { items, ...listData } = list;
      await F.setDoc(listDoc(list.id), {
        ...listData, ownerUid: myUid, ownerName: state.gifterName || '',
        createdAt: F.serverTimestamp(),
      });
      for (const item of items) {
        await F.setDoc(itemDoc(list.id, item.id), { ...item, taken: false, familyId });
      }
    } catch { /* already exists / owned elsewhere — skip */ }
  }
  state.revealed = {};
  prefs.revealed = {};
  savePrefs();
  currentListId = null; historyStack = ['home']; render(); show('home');
  if (kept.length) {
    alert('Demo data reset. Lists created on another device (' + kept.join(', ') + ') were left as they are — only the device that created a list can delete it.');
  }
}

/* ---- forms ---- */
$('#giftForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const list = findList(currentListId);
  if (!list) return;
  const data = {
    name: $('#giftName').value.trim(),
    link: $('#giftLink').value.trim(),
    price: parseFloat($('#giftPrice').value) || 0,
    details: $('#giftDetails').value.trim(),
    wanted: parseInt($('#giftWanted').value, 10) || 2,
    familyOnly: $('#giftFamilyOnly').checked,
  };
  if (!data.name) return;
  const editing = e.target.dataset.editing;
  if (mode === 'local') {
    if (editing) {
      const item = list.items.find((i) => i.id === editing);
      if (item) Object.assign(item, data);
    } else {
      list.items.push({ id: uid(), ...data, claimedBy: '', bought: false, taken: false });
    }
    saveLocal();
  } else {
    if (!canEdit(list)) { denyAlert(); return; }
    try {
      if (editing) {
        await F.updateDoc(itemDoc(list.id, editing), data);
      } else {
        await F.addDoc(itemsCol(list.id), { ...data, taken: false, familyId });
      }
    } catch (err) {
      if (err && err.code === 'permission-denied') denyAlert();
      else alert('Could not save right now. Check your connection and try again.');
      return;
    }
  }
  e.target.dataset.editing = '';
  giftFormOpen = false;
  e.target.hidden = true; e.target.reset();
  render();
});

$('#listForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const person = $('#listPerson').value.trim();
  if (!person) return;
  const listData = {
    person,
    occasion: $('#listOccasion').value.trim() || 'Wishlist',
    budget: parseFloat($('#listBudget').value) || 0,
    isChild: $('#listIsChild').checked,
    managedBy: $('#listManagedBy').value.trim(),
  };
  if (mode === 'local') {
    const list = { id: uid(), ...listData, items: [] };
    state.lists.push(list); saveLocal();
    currentListId = list.id;
  } else {
    try {
      const ref = await F.addDoc(listsCol(), {
        ...listData, ownerUid: myUid, ownerName: state.gifterName || '',
        createdAt: F.serverTimestamp(),
      });
      currentListId = ref.id;
    } catch (err) {
      alert('Could not create the list right now. Check your connection and try again.');
      return;
    }
  }
  e.target.reset();
  historyStack.push('list'); render(); show('list');
});

$('#santaForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const participants = $('#santaPeople').value.split('\n').map((s) => s.trim()).filter(Boolean);
  const unique = [...new Set(participants)];
  if (unique.length < 3) { $('#santaStatus').textContent = 'Secret Santa needs at least 3 people.'; return; }
  const exclusions = $('#santaExclusions').value.split('\n').map((line) => line.split(',').map((s) => s.trim()).filter(Boolean)).filter((p) => p.length === 2);
  const lastYear = {};
  $('#santaLastYear').value.split('\n').forEach((line) => {
    const m = line.match(/(.+?)\s*->\s*(.+)/);
    if (m) lastYear[m[1].trim()] = m[2].trim();
  });
  const draw = drawSanta(unique, exclusions, lastYear);
  if (!draw) {
    $('#santaStatus').textContent = 'No valid draw with those rules — try removing a keep-apart pair or a last-year rule.';
    return;
  }
  if (mode === 'local') {
    state.santa = { participants: unique, exclusions, lastYear, draw };
    saveLocal(); renderSanta();
  } else {
    try {
      await F.setDoc(santaDoc(), { participants: unique, exclusions, lastYear, draw }, { merge: true });
    } catch (err) {
      alert('Could not save the draw right now. Check your connection and try again.');
      return;
    }
  }
  $('#santaStatus').textContent = 'Draw complete. Each person taps their own name to reveal their match.';
});

function drawSanta(people, exclusions, lastYear) {
  const forbidden = new Set();
  exclusions.forEach(([a, b]) => { forbidden.add(a + '|' + b); forbidden.add(b + '|' + a); });
  for (let attempt = 0; attempt < 500; attempt++) {
    const recipients = [...people];
    for (let i = recipients.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [recipients[i], recipients[j]] = [recipients[j], recipients[i]];
    }
    let ok = true;
    const draw = {};
    people.forEach((giver, idx) => {
      const r = recipients[idx];
      if (r === giver) ok = false;
      if (forbidden.has(giver + '|' + r)) ok = false;
      if (lastYear[giver] && lastYear[giver] === r) ok = false;
      draw[giver] = r;
    });
    if (ok) return draw;
  }
  return null;
}

/* ---- Firebase init with localStorage fallback ---- */
async function initFirebase() {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  const appMod = await import(`${base}/firebase-app.js`);
  const authMod = await import(`${base}/firebase-auth.js`);
  const fsMod = await import(`${base}/firebase-firestore.js`);
  const app = appMod.initializeApp(FIREBASE_CONFIG);
  const auth = authMod.getAuth(app);
  try {
    db = fsMod.initializeFirestore(app, {
      localCache: fsMod.persistentLocalCache({ tabManager: fsMod.persistentMultipleTabManager() }),
    });
  } catch {
    // IndexedDB unavailable (private mode, file://): run without persistence.
    db = fsMod.getFirestore(app);
  }
  F = fsMod;
  const waitForUser = () => new Promise((resolve, reject) => {
    const unsub = authMod.onAuthStateChanged(auth, (u) => { unsub(); resolve(u); }, (e) => { unsub(); reject(e); });
  });
  let user = await waitForUser();
  if (!user) {
    await authMod.signInAnonymously(auth);
    user = await waitForUser();
  }
  if (!user) throw new Error('anonymous sign-in returned no user');
  myUid = user.uid;
}

async function init() {
  setSyncStatus('connecting');
  let firebaseOk = false;
  try {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('firebase init timed out')), 10000));
    await Promise.race([initFirebase(), timeout]);
    firebaseOk = true;
  } catch (err) {
    console.warn('Firebase unavailable, using on-device mode', err);
  }
  if (firebaseOk) {
    mode = 'firebase';
    subscribeLists();
    subscribeClaims();
    subscribeSanta();
    maybeSeed();
    window.addEventListener('online', () => { if (hasSynced) setSyncStatus('synced'); });
    window.addEventListener('offline', () => setSyncStatus('offline'));
  } else {
    mode = 'local';
    loadLocal();
    setSyncStatus('local');
    const note = $('#privacyNote');
    if (note) {
      note.innerHTML = '<strong>Stored on this device only.</strong> Sync is unavailable right now '
        + '(Firebase could not be reached), so lists save in this browser and do not sync across '
        + 'devices. No account, no ads, no analytics, no tracking.';
    }
  }
  render();
  show('home');
}

init();
