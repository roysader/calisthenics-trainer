import { store, BANDS, PRESET_MOVES } from './store.js';

const $app = document.getElementById('app');
let activeTab = 'home';
let keypadState = null; // { moveId, mode: 'log' | 'maxtest', reps: '', band: 'none' }
let actionSheetState = null; // { moveId }
let confirmState = null; // { title, body, confirmLabel, danger, onConfirm }
let timerState = { remaining: 90, running: false, intervalId: null };
let audioCtx = null;

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const TAB_TITLES = { home: 'Your Moves', timer: 'Rest Timer', progress: 'Progress' };

// ---------- Rendering ----------
function render() {
  $app.innerHTML = '';
  $app.appendChild(renderTopBar());
  const content = el('<div class="content"></div>');
  if (activeTab === 'home') content.appendChild(renderHome());
  if (activeTab === 'timer') content.appendChild(renderTimer());
  if (activeTab === 'progress') content.appendChild(renderProgress());
  $app.appendChild(content);
  $app.appendChild(renderTabBar());
  if (keypadState) $app.appendChild(renderKeypad());
  if (actionSheetState) $app.appendChild(renderActionSheet());
  if (confirmState) $app.appendChild(renderConfirm());
}

function renderTopBar() {
  return el(`<header class="topbar"><h1>${TAB_TITLES[activeTab]}</h1></header>`);
}

function renderTabBar() {
  const bar = el('<nav class="tabbar"></nav>');
  for (const [key, label, icon] of [
    ['home', 'Moves', '💪'],
    ['timer', 'Timer', '⏱'],
    ['progress', 'Progress', '📈'],
  ]) {
    const btn = el(`<button class="tab ${activeTab === key ? 'active' : ''}">
      <span class="tab-icon">${icon}</span><span>${label}</span>
    </button>`);
    btn.addEventListener('click', () => {
      activeTab = key;
      render();
    });
    bar.appendChild(btn);
  }
  return bar;
}

function renderHome() {
  const wrap = el('<div class="home"></div>');

  if (store.needsDeload()) {
    wrap.appendChild(el(`<div class="banner">🪫 It's been 5+ weeks — consider a deload session (~50% volume) this week.
      <button class="link-btn" id="deload-btn">Mark deload done</button></div>`));
  }

  const grid = el('<div class="move-grid"></div>');
  for (const move of store.data.moves) {
    grid.appendChild(renderMoveCard(move));
  }
  wrap.appendChild(grid);

  const addBtn = el('<button class="add-move-btn">+ Add move</button>');
  addBtn.addEventListener('click', openAddMovePicker);
  wrap.appendChild(addBtn);

  wrap.querySelector('#deload-btn')?.addEventListener('click', () => {
    store.markDeload();
    render();
  });

  return wrap;
}

function renderMoveCard(move) {
  const status = store.getPlanStatus(move.id);
  const recent = store.sessionsForMove(move.id)[0];

  let body;
  if (!status.hasMaxTest) {
    body = `<div class="card-sub">No max test yet — tap to find your baseline</div>`;
  } else {
    let progressPct = 0;
    if (recent) progressPct = Math.min(100, Math.round((recent.reps / status.target.reps) * 100));
    body = `
      <div class="card-target">Target: ${status.target.reps} reps × ${status.target.sets} sets</div>
      <div class="progress-track"><div class="progress-fill" style="width:${progressPct}%"></div></div>`;
    if (recent) {
      body += `<div class="card-sub">Last: ${recent.reps} reps${recent.band !== 'none' ? ` · <span class="band-dot band-${recent.band}"></span>${BANDS[recent.band].label}` : ''} · ${fmtDate(recent.loggedAt)}</div>`;
    }
    if (status.suggestion) {
      body += `<div class="card-suggestion">✅ ${status.suggestion}</div>`;
    }
  }

  const card = el(`<div class="move-card ${status.readyToRetest ? 'ready' : ''}">
    <div class="card-title-row">
      <div class="card-title">${move.name}</div>
      <button class="card-more" aria-label="Options">⋯</button>
    </div>
    ${body}
  </div>`);

  const openSheet = (e) => {
    e.stopPropagation();
    openActionSheet(move.id);
  };
  card.querySelector('.card-more').addEventListener('click', openSheet);
  attachLongPress(card, () => openActionSheet(move.id), () => {
    if (!status.hasMaxTest) openKeypad(move.id, 'maxtest');
    else openKeypad(move.id, 'log');
  });
  return card;
}

function attachLongPress(target, onLongPress, onClick) {
  let timer = null;
  let fired = false;
  const start = () => {
    fired = false;
    timer = setTimeout(() => {
      fired = true;
      if (navigator.vibrate) navigator.vibrate(15);
      onLongPress();
    }, 500);
  };
  const cancel = () => clearTimeout(timer);
  target.addEventListener('pointerdown', start);
  target.addEventListener('pointerup', cancel);
  target.addEventListener('pointerleave', cancel);
  target.addEventListener('pointercancel', cancel);
  target.addEventListener('click', (e) => {
    if (e.target.closest('.card-more')) return;
    if (fired) { fired = false; return; }
    onClick(e);
  });
}

function openAddMovePicker() {
  const existingNames = new Set(store.data.moves.map((m) => m.name));
  const options = PRESET_MOVES.filter((p) => !existingNames.has(p.name));
  const overlay = el('<div class="overlay"></div>');
  const list = options
    .map((p) => `<button class="preset-item" data-name="${p.name}" data-assist="${p.isAssistable}">${p.name}</button>`)
    .join('');
  const modal = el(`<div class="modal picker">
    <div class="modal-header">Add a move <button class="close-btn">✕</button></div>
    <div class="preset-list">${list || '<div class="card-sub">All preset moves added</div>'}</div>
  </div>`);
  overlay.appendChild(modal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  modal.querySelector('.close-btn').addEventListener('click', () => overlay.remove());
  modal.querySelectorAll('.preset-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      store.addMove(btn.dataset.name, btn.dataset.assist === 'true');
      overlay.remove();
      render();
    });
  });
  document.body.appendChild(overlay);
}

// ---------- Keypad ----------
function openKeypad(moveId, mode) {
  keypadState = { moveId, mode, reps: '', band: 'none' };
  render();
}

function closeKeypad() {
  keypadState = null;
  render();
}

function renderKeypad() {
  const move = store.data.moves.find((m) => m.id === keypadState.moveId);
  const target = store.getTarget(move.id);
  const isMaxTest = keypadState.mode === 'maxtest';

  const overlay = el('<div class="overlay keypad-overlay"></div>');
  const modal = el(`<div class="modal keypad-modal">
    <div class="modal-header">
      ${isMaxTest ? 'Max Test: ' : ''}${move.name}
      <button class="close-btn">✕</button>
    </div>
    ${isMaxTest ? '<div class="card-sub">Do as many clean unassisted reps as you can.</div>' : ''}
    ${!isMaxTest && target ? `<div class="card-target">Target: ${target.reps} reps × ${target.sets} sets</div>` : ''}
    <div class="reps-display">${keypadState.reps || '0'}</div>
    ${move.isAssistable ? renderBandChips() : ''}
    <div class="keypad-grid"></div>
    <div class="keypad-actions">
      <button class="kp-clear">Clear</button>
      <button class="kp-save">Save</button>
    </div>
    ${!isMaxTest ? '<button class="retest-link">Retest max instead</button>' : ''}
  </div>`);

  const grid = modal.querySelector('.keypad-grid');
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', ''].forEach((k) => {
    if (k === '') { grid.appendChild(el('<div></div>')); return; }
    const btn = el(`<button class="kp-key">${k}</button>`);
    btn.addEventListener('click', () => {
      if (k === '⌫') keypadState.reps = keypadState.reps.slice(0, -1);
      else if (keypadState.reps.length < 3) keypadState.reps += k;
      updateRepsDisplay(modal);
    });
    grid.appendChild(btn);
  });

  modal.querySelectorAll('.band-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      keypadState.band = chip.dataset.band;
      modal.querySelectorAll('.band-chip').forEach((c) => c.classList.toggle('active', c === chip));
    });
  });

  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeKeypad(); });
  modal.querySelector('.close-btn').addEventListener('click', closeKeypad);
  modal.querySelector('.kp-clear').addEventListener('click', () => {
    keypadState.reps = '';
    updateRepsDisplay(modal);
  });
  modal.querySelector('.kp-save').addEventListener('click', () => {
    const reps = parseInt(keypadState.reps, 10);
    if (!reps || reps < 1) return;
    if (isMaxTest) store.setMaxTest(move.id, reps, keypadState.band);
    else store.logSession(move.id, reps, keypadState.band);
    closeKeypad();
  });
  modal.querySelector('.retest-link')?.addEventListener('click', () => {
    keypadState = { moveId: move.id, mode: 'maxtest', reps: '', band: 'none' };
    render();
  });

  overlay.appendChild(modal);
  return overlay;
}

// ---------- Action sheet (move options) ----------
function openActionSheet(moveId) {
  actionSheetState = { moveId };
  render();
}

function closeActionSheet() {
  actionSheetState = null;
  render();
}

function renderActionSheet() {
  const move = store.data.moves.find((m) => m.id === actionSheetState.moveId);
  const status = store.getPlanStatus(move.id);
  const overlay = el('<div class="overlay"></div>');
  const modal = el(`<div class="modal action-sheet">
    <div class="modal-header">${move.name} <button class="close-btn">✕</button></div>
    <div class="sheet-actions">
      <button class="sheet-btn" data-action="log">📝 Log a set</button>
      <button class="sheet-btn" data-action="maxtest">🏆 ${status.hasMaxTest ? 'Retest baseline max' : 'Set baseline max'}</button>
      <button class="sheet-btn danger" data-action="delete">🗑 Delete move</button>
    </div>
  </div>`);
  overlay.appendChild(modal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeActionSheet(); });
  modal.querySelector('.close-btn').addEventListener('click', closeActionSheet);
  modal.querySelector('[data-action="log"]').addEventListener('click', () => {
    closeActionSheet();
    openKeypad(move.id, 'log');
  });
  modal.querySelector('[data-action="maxtest"]').addEventListener('click', () => {
    closeActionSheet();
    openKeypad(move.id, 'maxtest');
  });
  modal.querySelector('[data-action="delete"]').addEventListener('click', () => {
    closeActionSheet();
    openConfirm({
      title: `Delete ${move.name}?`,
      body: 'This permanently removes this move along with its baseline max and all logged history.',
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: () => store.deleteMove(move.id),
    });
  });
  return overlay;
}

// ---------- Confirm dialog ----------
function openConfirm(opts) {
  confirmState = opts;
  render();
}

function closeConfirm() {
  confirmState = null;
  render();
}

function renderConfirm() {
  const { title, body, confirmLabel = 'Confirm', danger = false } = confirmState;
  const overlay = el('<div class="overlay confirm-overlay"></div>');
  const modal = el(`<div class="modal confirm-modal">
    <div class="confirm-title">${title}</div>
    <div class="confirm-body">${body}</div>
    <div class="confirm-actions">
      <button class="confirm-cancel">Cancel</button>
      <button class="confirm-ok ${danger ? 'danger' : ''}">${confirmLabel}</button>
    </div>
  </div>`);
  overlay.appendChild(modal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeConfirm(); });
  modal.querySelector('.confirm-cancel').addEventListener('click', closeConfirm);
  modal.querySelector('.confirm-ok').addEventListener('click', () => {
    const { onConfirm } = confirmState;
    closeConfirm();
    onConfirm?.();
  });
  return overlay;
}

function renderBandChips() {
  const chips = Object.entries(BANDS)
    .map(([key, b]) => `<button class="band-chip band-${key} ${keypadState.band === key ? 'active' : ''}" data-band="${key}">${b.label}${b.kg ? ` (${b.kg}kg)` : ''}</button>`)
    .join('');
  return `<div class="band-chips">${chips}</div>`;
}

function updateRepsDisplay(modal) {
  modal.querySelector('.reps-display').textContent = keypadState.reps || '0';
}

// ---------- Timer ----------
function renderTimer() {
  const wrap = el(`<div class="timer-view">
    <div class="timer-display">${formatTime(timerState.remaining)}</div>
    <div class="timer-controls">
      <button class="timer-btn" id="t-minus">-15s</button>
      <button class="timer-btn primary" id="t-toggle">${timerState.running ? 'Pause' : 'Start'}</button>
      <button class="timer-btn" id="t-plus">+15s</button>
    </div>
    <button class="timer-reset" id="t-reset">Reset</button>
    <div class="timer-setting">
      Rest duration: <input type="number" id="t-duration" value="${store.data.settings.restSeconds}" min="10" step="5"> sec
    </div>
  </div>`);

  wrap.querySelector('#t-toggle').addEventListener('click', toggleTimer);
  wrap.querySelector('#t-reset').addEventListener('click', resetTimer);
  wrap.querySelector('#t-minus').addEventListener('click', () => adjustTimer(-15));
  wrap.querySelector('#t-plus').addEventListener('click', () => adjustTimer(15));
  wrap.querySelector('#t-duration').addEventListener('change', (e) => {
    const val = Math.max(10, parseInt(e.target.value, 10) || 90);
    store.updateSettings({ restSeconds: val });
    if (!timerState.running) {
      timerState.remaining = val;
      render();
    }
  });

  return wrap;
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function toggleTimer() {
  if (timerState.running) {
    clearInterval(timerState.intervalId);
    timerState.running = false;
  } else {
    if (timerState.remaining <= 0) timerState.remaining = store.data.settings.restSeconds;
    timerState.running = true;
    timerState.intervalId = setInterval(() => {
      timerState.remaining -= 1;
      if (timerState.remaining <= 0) {
        clearInterval(timerState.intervalId);
        timerState.running = false;
        timerState.remaining = 0;
        playBeep();
        vibrate();
      }
      if (activeTab === 'timer') updateTimerDisplay();
    }, 1000);
  }
  render();
}

function resetTimer() {
  clearInterval(timerState.intervalId);
  timerState.running = false;
  timerState.remaining = store.data.settings.restSeconds;
  render();
}

function adjustTimer(delta) {
  timerState.remaining = Math.max(0, timerState.remaining + delta);
  if (activeTab === 'timer') updateTimerDisplay();
}

function updateTimerDisplay() {
  const disp = document.querySelector('.timer-display');
  if (disp) disp.textContent = formatTime(timerState.remaining);
  const toggleBtn = document.querySelector('#t-toggle');
  if (toggleBtn) toggleBtn.textContent = timerState.running ? 'Pause' : 'Start';
}

function playBeep() {
  if (!store.data.settings.soundOn) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.3, audioCtx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.5);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.55);
    setTimeout(() => {
      const osc2 = audioCtx.createOscillator();
      const gain2 = audioCtx.createGain();
      osc2.type = 'sine';
      osc2.frequency.value = 1046;
      gain2.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      gain2.gain.exponentialRampToValueAtTime(0.3, audioCtx.currentTime + 0.02);
      gain2.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.5);
      osc2.connect(gain2).connect(audioCtx.destination);
      osc2.start();
      osc2.stop(audioCtx.currentTime + 0.55);
    }, 180);
  } catch (e) {
    console.error('Beep failed', e);
  }
}

function vibrate() {
  if (store.data.settings.vibrateOn && navigator.vibrate) navigator.vibrate([200, 100, 200]);
}

// unlock audio context on first tap anywhere (iOS requirement)
document.addEventListener(
  'click',
  () => {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {}
    }
  },
  { once: true }
);

// ---------- Progress ----------
function renderProgress() {
  const wrap = el('<div class="progress-view"></div>');
  if (store.data.moves.length === 0) {
    wrap.appendChild(el('<div class="card-sub">Add a move to start tracking progress.</div>'));
    return wrap;
  }
  for (const move of store.data.moves) {
    const sessions = store.sessionsForMove(move.id).slice(0, 8);
    const max = store.data.maxTests[move.id];
    const section = el(`<div class="progress-section">
      <div class="card-title">${move.name}</div>
      ${max ? `<div class="card-sub">Baseline max: ${max.reps} reps${max.band !== 'none' ? ' · ' + BANDS[max.band].label : ''} (${fmtDate(max.testedAt)})</div>` : '<div class="card-sub">No max test yet</div>'}
      <div class="history-list">
        ${sessions.length ? sessions.map((s) => `<div class="history-row"><span>${fmtDate(s.loggedAt)}${s.isMaxTest ? ' <span class="maxtest-badge">🏆 max</span>' : ''}</span><span>${s.reps} reps</span><span>${s.band !== 'none' ? `<span class="band-dot band-${s.band}"></span>${BANDS[s.band].label}` : ''}</span></div>`).join('') : '<div class="card-sub">No sessions logged yet</div>'}
      </div>
    </div>`);
    wrap.appendChild(section);
  }
  return wrap;
}

// ---------- Init ----------
store.onChange(() => {
  if (activeTab !== 'timer') render();
});
render();
store.init();
