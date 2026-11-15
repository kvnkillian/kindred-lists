'use strict';
/* Kindred Lists — static version.
 * No backend, no account, no ads, no analytics.
 * Persistence is localStorage only: data survives closing the tab on
 * this device, and does not sync across devices yet. Sync is a later
 * CloudKit / backend step. */
const STORAGE_KEY = 'kindred-lists-v1';
const $ = (s) => document.querySelector(s);

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

function seed() {
  return {
    gifterName: '',
    view: 'owner',
    lists: [
      {
        id: 'alex', person: 'Alex', occasion: 'Christmas 2026', budget: 200,
        isChild: false, managedBy: '',
        items: [
          { id: uid(), name: 'Kindle Paperwhite', link: 'https://www.amazon.com/dp/B0C75RBY21', price: 149.99, details: '16GB, Agave Green', wanted: 3, familyOnly: false, claimedBy: '', bought: false },
          { id: uid(), name: 'Cozy throw blanket', link: '', price: 45, details: 'Cream, washable', wanted: 2, familyOnly: false, claimedBy: '', bought: false },
        ],
      },
      {
        id: 'kevin', person: 'Kevin', occasion: 'Christmas 2026', budget: 150,
        isChild: false, managedBy: '',
        items: [
          { id: uid(), name: 'Pour-over coffee set', link: '', price: 38, details: 'Dripper + filters', wanted: 2, familyOnly: false, claimedBy: '', bought: false },
        ],
      },
      {
        id: 'baby', person: 'Baby', occasion: 'Christmas 2026 · First Christmas', budget: 100,
        isChild: true, managedBy: 'Alex & Kevin',
        items: [
          { id: uid(), name: 'High-contrast board book', link: '', price: 12, details: 'Black-and-white, 0–6 months', wanted: 3, familyOnly: false, claimedBy: '', bought: false },
          { id: uid(), name: 'Soft plush rattle', link: '', price: 18, details: 'Machine washable', wanted: 2, familyOnly: true, claimedBy: '', bought: false },
        ],
      },
    ],
    santa: {
      participants: ['Alex', 'Kevin', 'Emma', 'Mark'],
      exclusions: [['Alex', 'Kevin']],
      lastYear: { Kevin: 'Emma', Alex: 'Mark', Emma: 'Kevin', Mark: 'Alex' },
      draw: {}, // giver -> recipient
      revealed: {}, // giver -> true once they tap to reveal
    },
  };
}

let state = load();
let currentListId = null;
let historyStack = ['home']; // one back button goes back one screen

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seed();
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.lists) || !parsed.santa) return seed();
    return parsed;
  } catch { return seed(); }
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* storage full / private mode: keep in-memory */ }
}
const money = (n) => '$' + (Number(n) || 0).toFixed(2).replace(/\.00$/, '');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const wantedLabel = (w) => ({ 3: 'Really want it', 2: 'Would love it', 1: 'Nice to have' }[w] || 'Would love it');
function claimedTotal(list) {
  return list.items.filter((i) => i.claimedBy).reduce((s, i) => s + (Number(i.price) || 0), 0);
}
function findList(id) { return state.lists.find((l) => l.id === id); }

/* ---- navigation: one back button, back one screen ---- */
function show(view) {
  document.querySelectorAll('.view').forEach((v) => { v.hidden = true; });
  const el = document.getElementById('view-' + view);
  if (el) el.hidden = false;
  $('#backBtn').hidden = historyStack.length <= 1;
  window.scrollTo(0, 0);
}
function go(view) {
  historyStack.push(view);
  render();
  show(view);
}
function goBack() {
  if (historyStack.length <= 1) return;
  historyStack.pop();
  render();
  show(historyStack[historyStack.length - 1]);
}
$('#backBtn').addEventListener('click', goBack);

/* ---- view switcher: Owner vs Family ---- */
function setView(v) {
  state.view = v; save();
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
  $('#listHeading').textContent = list.person + (list.isChild ? ' — child list' : '');
  $('#listMeta').textContent = (list.occasion || 'Wishlist')
    + (list.isChild && list.managedBy ? ' · Kept by ' + list.managedBy : '')
    + ' · Budget ' + money(list.budget) + ' per person';
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
  $('#addGiftBtn').hidden = state.view !== 'owner';
  $('#deleteListBtn').hidden = state.view !== 'owner';
  $('#giftForm').hidden = true;

  $('#itemList').innerHTML = visible.map((item) => {
    const isClaimed = Boolean(item.claimedBy);
    const mine = state.view === 'family' && item.claimedBy === state.gifterName && state.gifterName;
    let status = '';
    if (state.view === 'owner') {
      status = isClaimed ? '<p class="claimed">Reserved — name hidden to keep the surprise</p>' : '<p>Still open</p>';
    } else {
      status = isClaimed
        ? (mine
          ? '<p class="claimed">You reserved this' + (item.bought ? ' · Bought ✓' : '') + '</p>'
          : '<p class="claimed">Taken — reserved by someone else</p>')
        : '<p>Still open</p>';
    }
    const actions = state.view === 'owner'
      ? `<button type="button" class="btn" data-edit-item="${item.id}">Edit</button>
         <button type="button" class="btn danger" data-delete-item="${item.id}">Remove</button>`
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
  $('#santaPeople').value = s.participants.join('\n');
  $('#santaExclusions').value = s.exclusions.map((p) => p.join(', ')).join('\n');
  $('#santaLastYear').value = Object.entries(s.lastYear).map(([g, r]) => g + ' -> ' + r).join('\n');
  const hasDraw = Object.keys(s.draw).length > 0;
  $('#santaStatus').textContent = hasDraw
    ? 'Draw complete. Each person taps their own name to reveal their match — matches are not shown to anyone else.'
    : 'No draw yet. Add participants, then draw names.';
  $('#santaResults').innerHTML = hasDraw ? s.participants.map((giver) => {
    const revealed = s.revealed[giver];
    const recipient = s.draw[giver];
    return `<li><span><strong>${esc(giver)}</strong> → ${revealed ? '<strong>' + esc(recipient) + '</strong>' : '??? (tap to reveal)'}</span>
      <button type="button" class="btn" data-reveal-santa="${esc(giver)}" aria-label="Reveal ${esc(giver)}'s match">${revealed ? 'Hide' : 'Reveal my match'}</button></li>`;
  }).join('') : '';
}

function renderGiving() {
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
    state.santa.revealed[g] = !state.santa.revealed[g]; save(); renderSanta(); return;
  }

  const action = t.dataset.action;
  if (!action) return;
  if (action === 'new-list') go('new-list');
  if (action === 'go-santa') go('santa');
  if (action === 'go-giving') go('giving');
  if (action === 'cancel-new-list') goBack();
  if (action === 'cancel-gift') { $('#giftForm').hidden = true; }
  if (action === 'add-gift') {
    $('#giftForm').hidden = false;
    $('#giftFormHeading').textContent = 'Add a gift';
    $('#giftForm').dataset.editing = '';
    $('#giftForm').reset();
    $('#giftName').focus();
  }
  if (action === 'share-list') {
    const list = findList(currentListId);
    const text = 'Kindred Lists — ' + (list ? list.person + "'s list" : '') + ': kindredlists.link (this static version stores data on this device only; share the real link once sync lands)';
    const note = $('#shareNote');
    note.hidden = false;
    note.textContent = 'Invite note ready to copy: ' + text;
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
  }
  if (action === 'delete-list') {
    const list = findList(currentListId);
    if (list && confirm('Delete ' + list.person + "'s list? This can't be undone.")) {
      state.lists = state.lists.filter((l) => l.id !== list.id);
      currentListId = null; save(); historyStack = ['home']; render(); show('home');
    }
  }
  if (action === 'clear-santa') {
    state.santa.draw = {}; state.santa.revealed = {}; save(); renderSanta();
  }
  if (action === 'reset-demo') {
    if (confirm('Reset all lists and the Secret Santa draw to the example data? Your edits will be lost.')) {
      state = seed(); currentListId = null; historyStack = ['home']; save(); render(); show('home');
    }
  }
});

function askGifterName() {
  if (state.gifterName) return state.gifterName;
  const name = prompt('Your name, so other gifters see this gift is taken (the owner never sees it):');
  if (!name) return '';
  state.gifterName = name.trim(); save();
  return state.gifterName;
}
function claimItem(itemId, listId) {
  const name = askGifterName();
  if (!name) return;
  const list = findList(listId || currentListId);
  const item = list && list.items.find((i) => i.id === itemId);
  if (!item || item.claimedBy) return;
  item.claimedBy = name; item.bought = false; save(); render();
  alert('You reserved “' + item.name + '” for ' + list.person + '. The owner will not see your name.');
}
function releaseItem(itemId, listId) {
  const list = findList(listId || currentListId);
  const item = list && list.items.find((i) => i.id === itemId);
  if (item) { item.claimedBy = ''; item.bought = false; save(); render(); }
}
function toggleBought(itemId, listId) {
  const list = findList(listId || currentListId);
  const item = list && list.items.find((i) => i.id === itemId);
  if (item) { item.bought = !item.bought; save(); render(); }
}
function deleteItem(itemId) {
  const list = findList(currentListId);
  if (!list) return;
  if (confirm('Remove this gift from the list?')) {
    list.items = list.items.filter((i) => i.id !== itemId); save(); render();
  }
}
function editItem(itemId) {
  const list = findList(currentListId);
  const item = list && list.items.find((i) => i.id === itemId);
  if (!item) return;
  const form = $('#giftForm');
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

/* ---- forms ---- */
$('#giftForm').addEventListener('submit', (e) => {
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
  if (editing) {
    const item = list.items.find((i) => i.id === editing);
    if (item) Object.assign(item, data);
  } else {
    list.items.push({ id: uid(), ...data, claimedBy: '', bought: false });
  }
  e.target.dataset.editing = '';
  e.target.hidden = true; e.target.reset();
  save(); render();
});

$('#listForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const person = $('#listPerson').value.trim();
  if (!person) return;
  const list = {
    id: uid(), person,
    occasion: $('#listOccasion').value.trim() || 'Wishlist',
    budget: parseFloat($('#listBudget').value) || 0,
    isChild: $('#listIsChild').checked,
    managedBy: $('#listManagedBy').value.trim(),
    items: [],
  };
  state.lists.push(list); save();
  currentListId = list.id;
  e.target.reset();
  historyStack.push('list'); render(); show('list');
});

$('#santaForm').addEventListener('submit', (e) => {
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
  state.santa = { participants: unique, exclusions, lastYear, draw, revealed: {} };
  save(); renderSanta();
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

/* ---- init ---- */
render();
show('home');
