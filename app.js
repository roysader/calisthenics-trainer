import { store, BANDS, PRESET_MOVES, moveIcon, FOCUS_MOVE_NAME } from './store.js';

const $app = document.getElementById('app');
let activeTab = 'home';
let keypadState = null; // { moveId, mode: 'log' | 'maxtest', reps: '', band: 'none' }
let actionSheetState = null; // { moveId }
let confirmState = null; // { title, body, confirmLabel, danger, onConfirm }
let timerState = { remaining: 90, running: false, intervalId: null };
let audioCtx = null;
let dayCollapseState = {}; // dayKey -> expanded boolean, persists across re-renders

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const TAB_TITLES = { home: 'Your Moves', program: 'Program', timer: 'Rest Timer', progress: 'Progress' };

// ---------- Rendering ----------
function render() {
  $app.innerHTML = '';
  $app.appendChild(renderTopBar());
  const content = el('<div class="content"></div>');
  if (activeTab === 'home') content.appendChild(renderHome());
  if (activeTab === 'program') content.appendChild(renderProgram());
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
    ['program', 'Program', '🎯'],
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
  for (const move of store.orderedMoves()) {
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

  const card = el(`<div class="move-card ${status.readyToRetest ? 'ready' : ''}" data-move-id="${move.id}">
    <div class="card-title-row">
      <div class="card-title"><span class="move-icon">${moveIcon(move.name)}</span>${move.name}</div>
      <button class="card-more" aria-label="Options">⋯</button>
    </div>
    ${body}
  </div>`);

  const openSheet = (e) => {
    e.stopPropagation();
    openActionSheet(move.id);
  };
  card.querySelector('.card-more').addEventListener('click', openSheet);
  attachDragReorder(card, move, () => {
    if (!status.hasMaxTest) openKeypad(move.id, 'maxtest');
    else openKeypad(move.id, 'log');
  });
  return card;
}

// ---------- Program (adaptive focus plan) ----------
function renderProgram() {
  const wrap = el('<div class="program-view"></div>');
  const prog = store.getFocusProgram(FOCUS_MOVE_NAME);

  if (prog.status === 'missing') {
    wrap.appendChild(el(`<div class="progress-section">
      <div class="card-title">🎯 ${FOCUS_MOVE_NAME} Focus</div>
      <div class="card-sub">Add "${FOCUS_MOVE_NAME}" from the Moves tab to start a personalized program.</div>
    </div>`));
    return wrap;
  }

  wrap.appendChild(renderWeekStrip(prog.move.id));
  wrap.appendChild(renderProgramCard(prog));
  return wrap;
}

function renderWeekStrip(moveId) {
  const sessions = store.sessionsForMove(moveId);
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const trained = sessions.some((s) => s.loggedAt.slice(0, 10) === key);
    days.push({ label: d.toLocaleDateString(undefined, { weekday: 'narrow' }), trained, isToday: i === 0 });
  }
  const row = days
    .map((d) => `<div class="week-day"><div class="week-dot ${d.trained ? 'filled' : ''} ${d.isToday ? 'today' : ''}"></div><div class="week-label">${d.label}</div></div>`)
    .join('');
  return el(`<div class="week-strip">${row}</div>`);
}

function renderProgramCard(prog) {
  const { status, move } = prog;
  let body = '';
  let actions = [];

  if (status === 'needs-baseline') {
    body = `<div class="card-sub">No baseline max yet — test your max to generate a personalized target.</div>`;
    actions = [{ label: 'Set Baseline Max', primary: true, onClick: () => openKeypad(move.id, 'maxtest') }];
  } else if (status === 'deload') {
    body = `<div class="card-sub">🪫 It's been 5+ weeks since your last deload — ease off this week (~50% volume) on all pulling moves, including ${move.name}.</div>`;
    actions = [{ label: 'Mark Deload Done', primary: true, onClick: () => store.markDeload() }];
  } else if (status === 'retest') {
    body = `<div class="card-sub">✅ You've hit ${prog.target.reps} reps × ${prog.target.sets} sets two sessions running — time to retest your max.</div>`;
    actions = [{ label: 'Retest Max', primary: true, onClick: () => openKeypad(move.id, 'maxtest') }];
  } else if (status === 'trained-today') {
    body = `<div class="card-sub">Nice work — you already trained ${move.name} today. Let it recover; rest or stick to light accessory pulling tomorrow.</div>`;
    actions = [{ label: 'Log Another Set', primary: false, onClick: () => openKeypad(move.id, 'log') }];
  } else if (status === 'recovery') {
    body = `<div class="card-sub">Trained yesterday — today's a recovery day for ${move.name}.${prog.accessory ? ` If you want light volume, ${prog.accessory.name} is a good low-fatigue accessory today.` : ' Rest this move today.'}</div>`;
    if (prog.accessory) {
      actions = [{ label: `Log ${prog.accessory.name}`, primary: false, onClick: () => openKeypad(prog.accessory.id, 'log') }];
    }
  } else if (status === 'train') {
    const daysNote = Number.isFinite(prog.daysSince) ? `Last trained ${prog.daysSince} day${prog.daysSince === 1 ? '' : 's'} ago.` : "You haven't logged this move yet.";
    body = `
      <div class="card-target">Target: ${prog.target.reps} reps × ${prog.target.sets} sets</div>
      <div class="card-sub">${daysNote}</div>
      ${prog.accessory ? `<div class="card-sub">Finish with a few sets of ${prog.accessory.name} to build supporting pull strength.</div>` : ''}`;
    actions = [{ label: 'Log a Set', primary: true, onClick: () => openKeypad(move.id, 'log') }];
    if (prog.accessory) {
      actions.push({ label: `Log ${prog.accessory.name}`, primary: false, onClick: () => openKeypad(prog.accessory.id, 'log') });
    }
  }

  const card = el(`<div class="progress-section program-card">
    <div class="card-title">${moveIcon(move.name)} ${move.name} Focus</div>
    ${body}
    <div class="program-actions"></div>
  </div>`);

  const actionsWrap = card.querySelector('.program-actions');
  for (const a of actions) {
    const btn = el(`<button class="program-btn ${a.primary ? 'primary' : ''}">${a.label}</button>`);
    btn.addEventListener('click', a.onClick);
    actionsWrap.appendChild(btn);
  }

  return card;
}

// Hold-and-drag to reorder a move card; a quick tap (release before the hold
// threshold, or before moving) still opens the keypad via onTap, unchanged.
function attachDragReorder(card, move, onTap) {
  const HOLD_MS = 320;
  const MOVE_CANCEL_PX = 8;
  let holdTimer = null;
  let startX = 0;
  let startY = 0;
  let suppressClick = false;

  function onPointerDown(e) {
    if (e.target.closest('.card-more')) return;
    startX = e.clientX;
    startY = e.clientY;
    suppressClick = false;
    holdTimer = setTimeout(() => beginDrag(e), HOLD_MS);
    card.addEventListener('pointermove', onPreMove);
    card.addEventListener('pointerup', onPreEnd, { once: true });
    card.addEventListener('pointercancel', onPreEnd, { once: true });
  }

  function onPreMove(e) {
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > MOVE_CANCEL_PX) cleanupPre();
  }

  function onPreEnd() {
    cleanupPre();
  }

  function cleanupPre() {
    clearTimeout(holdTimer);
    card.removeEventListener('pointermove', onPreMove);
  }

  function beginDrag(e) {
    cleanupPre();
    suppressClick = true;
    if (navigator.vibrate) navigator.vibrate(15);
    startDragSession(card, move, e);
  }

  card.addEventListener('pointerdown', onPointerDown);
  card.addEventListener('click', (e) => {
    if (e.target.closest('.card-more')) return;
    if (suppressClick) { suppressClick = false; return; }
    onTap(e);
  });
}

function startDragSession(card, move, downEvent) {
  const grid = card.parentElement;
  const siblings = Array.from(grid.children);
  const gapPx = parseFloat(getComputedStyle(grid).rowGap || getComputedStyle(grid).gap || '10') || 10;
  const heights = siblings.map((sib) => sib.getBoundingClientRect().height);
  const initialOrder = siblings.map((sib) => sib.dataset.moveId);
  let order = initialOrder.slice();
  const draggedId = move.id;

  const slotTop = (ord, id) => {
    let top = 0;
    for (const otherId of ord) {
      if (otherId === id) break;
      const idx = initialOrder.indexOf(otherId);
      top += heights[idx] + gapPx;
    }
    return top;
  };
  const draggedHeight = heights[initialOrder.indexOf(draggedId)];
  const originalTop = slotTop(initialOrder, draggedId);

  grid.classList.add('reordering');
  card.classList.add('dragging');
  try { card.setPointerCapture(downEvent.pointerId); } catch (e) {}

  let latestY = downEvent.clientY;
  let rafId = null;
  let dragging = true;

  function applyFrame() {
    if (!dragging) return;
    const dy = latestY - downEvent.clientY;
    card.style.transform = `translateY(${dy}px)`;

    const draggedCenter = originalTop + draggedHeight / 2 + dy;
    const others = order.filter((id) => id !== draggedId);
    let newIndex = others.length;
    let running = 0;
    for (let i = 0; i < others.length; i++) {
      const idx = initialOrder.indexOf(others[i]);
      const h = heights[idx];
      if (draggedCenter < running + h / 2) { newIndex = i; break; }
      running += h + gapPx;
    }
    const newOrder = others.slice();
    newOrder.splice(newIndex, 0, draggedId);
    if (newOrder.join() !== order.join()) {
      order = newOrder;
      for (const sib of siblings) {
        const id = sib.dataset.moveId;
        if (id === draggedId) continue;
        const delta = slotTop(order, id) - slotTop(initialOrder, id);
        sib.style.transform = delta ? `translateY(${delta}px)` : '';
      }
    }
    rafId = requestAnimationFrame(applyFrame);
  }
  rafId = requestAnimationFrame(applyFrame);

  function onMove(e) {
    latestY = e.clientY;
  }

  function onEnd() {
    dragging = false;
    if (rafId) cancelAnimationFrame(rafId);
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onEnd);
    document.removeEventListener('pointercancel', onEnd);
    grid.classList.remove('reordering');
    card.classList.remove('dragging');
    for (const sib of siblings) sib.style.transform = '';
    if (order.join() !== initialOrder.join()) store.reorderMoves(order);
    render();
  }

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onEnd);
  document.addEventListener('pointercancel', onEnd);
}

function openAddMovePicker() {
  const existingNames = new Set(store.data.moves.map((m) => m.name));
  const options = PRESET_MOVES.filter((p) => !existingNames.has(p.name));
  const overlay = el('<div class="overlay"></div>');
  const list = options
    .map((p) => `<button class="preset-item" data-name="${p.name}" data-assist="${p.isAssistable}"><span class="move-icon">${p.icon}</span>${p.name}</button>`)
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
  const hasBaseline = !!store.data.maxTests[moveId];
  const effectiveMode = !hasBaseline && mode === 'log' ? 'maxtest' : mode;
  keypadState = { moveId, mode: effectiveMode, reps: '', band: 'none' };
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
      <span>${moveIcon(move.name)} ${isMaxTest ? 'Max Test: ' : ''}${move.name}</span>
      <button class="close-btn">✕</button>
    </div>
    ${isMaxTest ? '<div class="card-sub">Do as many clean unassisted reps as you can.</div>' : ''}
    ${!isMaxTest && target ? `<div class="card-target">Target: ${target.reps} reps × ${target.sets} sets</div>` : ''}
    <div class="reps-display">${keypadState.reps || '0'}</div>
    ${!isMaxTest && move.isAssistable ? renderBandChips() : ''}
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
  const wrap = el('<div class="sheet-wrap"></div>');
  const group = el(`<div class="sheet-group">
    <div class="sheet-title">${moveIcon(move.name)} ${move.name}</div>
    <button class="sheet-row" data-action="log">Log a Set</button>
    <button class="sheet-row" data-action="maxtest">${status.hasMaxTest ? 'Retest Baseline Max' : 'Set Baseline Max'}</button>
    <button class="sheet-row destructive" data-action="delete">Delete Move</button>
  </div>`);
  const cancel = el('<button class="sheet-cancel">Cancel</button>');
  wrap.appendChild(group);
  wrap.appendChild(cancel);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) closeActionSheet(); });
  cancel.addEventListener('click', closeActionSheet);
  group.querySelector('[data-action="log"]').addEventListener('click', () => {
    closeActionSheet();
    openKeypad(move.id, 'log');
  });
  group.querySelector('[data-action="maxtest"]').addEventListener('click', () => {
    closeActionSheet();
    openKeypad(move.id, 'maxtest');
  });
  group.querySelector('[data-action="delete"]').addEventListener('click', () => {
    closeActionSheet();
    openConfirm({
      title: `Delete ${move.name}?`,
      body: 'This permanently removes this move along with its baseline max and all logged history.',
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: () => store.deleteMove(move.id),
    });
  });
  return wrap;
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
  const overlay = el('<div class="alert-overlay"></div>');
  const alertBox = el(`<div class="alert">
    <div class="alert-title">${title}</div>
    <div class="alert-body">${body}</div>
    <div class="alert-actions">
      <button class="alert-btn cancel">Cancel</button>
      <button class="alert-btn bold ${danger ? 'danger' : ''}">${confirmLabel}</button>
    </div>
  </div>`);
  overlay.appendChild(alertBox);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeConfirm(); });
  alertBox.querySelector('.cancel').addEventListener('click', closeConfirm);
  alertBox.querySelector('.bold').addEventListener('click', () => {
    const { onConfirm } = confirmState;
    closeConfirm();
    onConfirm?.();
  });
  return overlay;
}

function renderBandChips() {
  const chips = Object.entries(BANDS)
    .map(([key, b]) => `<button class="band-chip band-${key} ${keypadState.band === key ? 'active' : ''}" data-band="${key}"><span class="band-check">✓ </span>${b.label}${b.kg ? ` (${b.kg}kg)` : ''}</button>`)
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
function fmtDayHeading(dayKey) {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (dayKey === today) return 'Today';
  if (dayKey === yesterday) return 'Yesterday';
  const d = new Date(`${dayKey}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function renderProgress() {
  const wrap = el('<div class="progress-view"></div>');
  const days = store.groupedHistory();
  if (days.length === 0) {
    wrap.appendChild(el('<div class="card-sub">Log a set to start tracking progress.</div>'));
    return wrap;
  }

  const moveOrder = store.orderedMoves().map((m) => m.id);

  days.forEach(({ day, sessions }, i) => {
    if (!(day in dayCollapseState)) dayCollapseState[day] = i === 0;
    const expanded = dayCollapseState[day];

    const section = el(`<div class="day-section ${i % 2 === 0 ? 'even' : 'odd'} ${expanded ? 'expanded' : ''}">
      <div class="day-header">
        <div class="day-header-left"><span class="chevron">›</span><span class="day-title">${fmtDayHeading(day)}</span></div>
        <span class="day-count">${sessions.length} set${sessions.length === 1 ? '' : 's'}</span>
      </div>
      <div class="day-body"></div>
    </div>`);

    section.querySelector('.day-header').addEventListener('click', () => {
      dayCollapseState[day] = !dayCollapseState[day];
      render();
    });

    const body = section.querySelector('.day-body');
    const byMove = {};
    for (const s of sessions) (byMove[s.moveId] = byMove[s.moveId] || []).push(s);
    const moveIds = Object.keys(byMove).sort((a, b) => moveOrder.indexOf(a) - moveOrder.indexOf(b));

    // Continuation = a set that directly follows the same move in the TRUE
    // global timeline for the day (across every move), and adds a band —
    // e.g. 5 unassisted dips then 6 more with a band right after. Doing a
    // different move in between resets it, even though both dips sets still
    // land in the same "Dips" group below.
    const dayAsc = sessions.slice().sort((a, b) => new Date(a.loggedAt) - new Date(b.loggedAt));
    const continuationIds = new Set();
    for (let k = 1; k < dayAsc.length; k++) {
      if (dayAsc[k - 1].moveId === dayAsc[k].moveId && dayAsc[k].band !== 'none') {
        continuationIds.add(dayAsc[k].id);
      }
    }

    for (const moveId of moveIds) {
      const move = store.data.moves.find((m) => m.id === moveId);
      if (!move) continue;
      // Oldest first: the first set of the day is the freshest attempt (Max Rep).
      const moveSessions = byMove[moveId].slice().sort((a, b) => new Date(a.loggedAt) - new Date(b.loggedAt));
      const totalReps = moveSessions.reduce((sum, s) => sum + s.reps, 0);
      const group = el(`<div class="move-group">
        <div class="move-group-title">
          <span class="move-icon">${moveIcon(move.name)}</span>${move.name}
          <span class="move-total">${totalReps} reps</span>
        </div>
        <div class="history-list"></div>
      </div>`);
      const list = group.querySelector('.history-list');
      moveSessions.forEach((s, idx) => {
        const isMaxRep = idx === 0;
        const isContinuation = continuationIds.has(s.id);
        const badges = [];
        if (s.isMaxTest) badges.push('<span class="maxtest-badge">🏆 max</span>');
        if (isMaxRep) badges.push('<span class="maxrep-badge">★ Max Rep</span>');

        const row = el(`<div class="history-row ${isContinuation ? 'continuation' : ''} ${isMaxRep ? 'day-best' : ''}" data-id="${s.id}">
            <span class="history-date">${isContinuation ? '' : fmtDate(s.loggedAt)}</span>
            <span class="history-reps">${isContinuation ? '↳ ' : ''}${s.reps} reps</span>
            <span class="history-band">${s.band !== 'none' ? `<span class="band-dot band-${s.band}"></span>${BANDS[s.band].label}` : ''}</span>
            <span class="history-trail">${badges.join(' ')}<button class="history-delete" aria-label="Delete entry">✕</button></span>
          </div>`);
        row.querySelector('.history-delete').addEventListener('click', () => {
          openConfirm({
            title: 'Delete this entry?',
            body: `Removes the ${s.reps}-rep log from ${fmtDate(s.loggedAt)} for ${move.name}. This can't be undone.`,
            confirmLabel: 'Delete',
            danger: true,
            onConfirm: () => store.deleteSession(s.id),
          });
        });
        list.appendChild(row);
      });
      body.appendChild(group);
    }

    wrap.appendChild(section);
  });

  return wrap;
}

// ---------- Init ----------
store.onChange(() => {
  if (activeTab !== 'timer') render();
});
render();
store.init();
