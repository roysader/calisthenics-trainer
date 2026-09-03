import { getClient, signInAnon, SUPABASE_CONFIGURED } from './supabaseClient.js';

const LS_KEY = 'calisthenics-data-v1';
const DAY_MS = 24 * 60 * 60 * 1000;

export const BANDS = {
  none: { label: 'None', kg: 0 },
  blue: { label: 'Blue', kg: 10 },
  yellow: { label: 'Yellow', kg: 20 },
  red: { label: 'Red', kg: 30 },
};

export const DEFAULT_ICON = '💪';

export const PRESET_MOVES = [
  { name: 'Reverse Row', isAssistable: false, icon: '🚣' },
  { name: 'Dips', isAssistable: true, icon: '🤸' },
  { name: 'Wide Pull-up', isAssistable: true, icon: '🦍' },
  { name: 'Pull-up', isAssistable: true, icon: '💪' },
  { name: 'Chin-up', isAssistable: true, icon: '🙆' },
  { name: 'Bar Pushup', isAssistable: false, icon: '🏋️' },
  { name: 'Diamond Pushup', isAssistable: false, icon: '💎' },
  { name: 'Archer Pushup', isAssistable: false, icon: '🏹' },
  { name: 'Squat', isAssistable: false, icon: '🦵' },
  { name: 'Pistol Squat', isAssistable: false, icon: '🔫' },
  { name: 'Bulgarian Split Squat', isAssistable: false, icon: '🧍' },
  { name: 'Muscle-up', isAssistable: true, icon: '🚀' },
  { name: 'Australian Row', isAssistable: false, icon: '🦘' },
  { name: 'L-sit', isAssistable: false, icon: '📐' },
  { name: 'Plank', isAssistable: false, icon: '🪵' },
  { name: 'Handstand Pushup', isAssistable: true, icon: '🙃' },
];

const DEFAULT_MOVE_NAMES = ['Reverse Row', 'Dips', 'Wide Pull-up', 'Pull-up', 'Bar Pushup', 'Squat'];

export const FOCUS_MOVE_NAME = 'Wide Pull-up';
const ACCESSORY_MOVE_NAMES = ['Pull-up', 'Chin-up', 'Reverse Row', 'Australian Row'];

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to read local data', e);
  }
  return null;
}

export function moveIcon(name) {
  return PRESET_MOVES.find((p) => p.name === name)?.icon || DEFAULT_ICON;
}

function seedData() {
  const moves = DEFAULT_MOVE_NAMES.map((name) => {
    const preset = PRESET_MOVES.find((p) => p.name === name);
    return { id: uid(), name, isAssistable: preset.isAssistable };
  });
  return {
    moves,
    moveOrder: moves.map((m) => m.id),
    maxTests: {},
    sessions: [],
    settings: { restSeconds: 90, soundOn: true, vibrateOn: true, lastDeload: Date.now() },
    pendingSync: [],
  };
}

class Store {
  constructor() {
    this.data = loadLocal() || seedData();
    if (!this.data.moveOrder) this.data.moveOrder = this.data.moves.map((m) => m.id);
    this.reconcileMoveOrder();
    this.user = null;
    this.listeners = new Set();
    this.persist();
  }

  async init() {
    if (SUPABASE_CONFIGURED) {
      this.user = await signInAnon();
      if (this.user) await this.pullFromCloud();
      this.flushQueue();
      window.addEventListener('online', () => this.flushQueue());
    }
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    this.persist();
    for (const fn of this.listeners) fn(this.data);
  }

  persist() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(this.data));
    } catch (e) {
      console.error('Failed to persist local data', e);
    }
  }

  queue(op) {
    this.data.pendingSync.push(op);
    if (navigator.onLine) this.flushQueue();
  }

  async flushQueue() {
    const sb = getClient();
    if (!sb || !this.user || this.data.pendingSync.length === 0) return;
    const remaining = [];
    for (const op of this.data.pendingSync) {
      try {
        await this.applyOpToCloud(sb, op);
      } catch (e) {
        console.error('Sync failed, will retry later', e);
        remaining.push(op);
      }
    }
    this.data.pendingSync = remaining;
    this.persist();
  }

  async applyOpToCloud(sb, op) {
    if (op.table === 'sessions' && op.type === 'insert') {
      await sb.from('sessions').insert({ ...op.row, user_id: this.user.id });
    } else if (op.table === 'max_tests' && op.type === 'upsert') {
      await sb.from('max_tests').upsert({ ...op.row, user_id: this.user.id }, { onConflict: 'user_id,move_id' });
    } else if (op.table === 'moves' && op.type === 'insert') {
      await sb.from('moves').insert({ ...op.row, user_id: this.user.id });
    } else if (op.table === 'moves' && op.type === 'delete') {
      await sb.from('moves').delete().eq('id', op.row.id).eq('user_id', this.user.id);
    } else if (op.table === 'sessions' && op.type === 'delete') {
      await sb.from('sessions').delete().eq('id', op.row.id).eq('user_id', this.user.id);
    } else if (op.table === 'sessions' && op.type === 'delete_for_move') {
      await sb.from('sessions').delete().eq('move_id', op.row.move_id).eq('user_id', this.user.id);
    } else if (op.table === 'max_tests' && op.type === 'delete_for_move') {
      await sb.from('max_tests').delete().eq('move_id', op.row.move_id).eq('user_id', this.user.id);
    } else if (op.table === 'settings' && op.type === 'upsert') {
      await sb.from('settings').upsert({ ...op.row, user_id: this.user.id }, { onConflict: 'user_id' });
    }
  }

  async pullFromCloud() {
    const sb = getClient();
    if (!sb || !this.user) return;
    const [{ data: moves }, { data: maxTests }, { data: sessions }, { data: settings }] = await Promise.all([
      sb.from('moves').select('*').eq('user_id', this.user.id),
      sb.from('max_tests').select('*').eq('user_id', this.user.id),
      sb.from('sessions').select('*').eq('user_id', this.user.id),
      sb.from('settings').select('*').eq('user_id', this.user.id).maybeSingle(),
    ]);
    if (moves && moves.length) {
      this.data.moves = moves.map((m) => ({ id: m.id, name: m.name, isAssistable: m.is_assistable }));
    }
    if (maxTests) {
      this.data.maxTests = {};
      for (const t of maxTests) this.data.maxTests[t.move_id] = { reps: t.reps, band: t.band, testedAt: t.tested_at };
    }
    if (sessions) {
      this.data.sessions = sessions.map((s) => ({ id: s.id, moveId: s.move_id, reps: s.reps, band: s.band, loggedAt: s.logged_at }));
    }
    if (settings) {
      this.data.settings = {
        restSeconds: settings.rest_seconds,
        soundOn: settings.sound_on,
        vibrateOn: settings.vibrate_on,
        lastDeload: settings.last_deload,
      };
    }
    this.reconcileMoveOrder();
    this.emit();
  }

  // ---- Moves ----
  addMove(name, isAssistable) {
    const move = { id: uid(), name, isAssistable };
    this.data.moves.push(move);
    this.reconcileMoveOrder();
    this.queue({ table: 'moves', type: 'insert', row: { id: move.id, name, is_assistable: isAssistable } });
    this.emit();
    return move;
  }

  deleteMove(moveId) {
    this.data.moves = this.data.moves.filter((m) => m.id !== moveId);
    delete this.data.maxTests[moveId];
    this.data.sessions = this.data.sessions.filter((s) => s.moveId !== moveId);
    this.reconcileMoveOrder();
    this.queue({ table: 'moves', type: 'delete', row: { id: moveId } });
    this.queue({ table: 'sessions', type: 'delete_for_move', row: { move_id: moveId } });
    this.queue({ table: 'max_tests', type: 'delete_for_move', row: { move_id: moveId } });
    this.emit();
  }

  // ---- Move order (local-only display order, never synced to Supabase) ----
  reconcileMoveOrder() {
    const ids = new Set(this.data.moves.map((m) => m.id));
    const order = (this.data.moveOrder || []).filter((id) => ids.has(id));
    for (const m of this.data.moves) {
      if (!order.includes(m.id)) order.push(m.id);
    }
    this.data.moveOrder = order;
  }

  orderedMoves() {
    const byId = new Map(this.data.moves.map((m) => [m.id, m]));
    return this.data.moveOrder.map((id) => byId.get(id)).filter(Boolean);
  }

  reorderMoves(newOrderIds) {
    const ids = new Set(this.data.moves.map((m) => m.id));
    if (newOrderIds.length !== ids.size || !newOrderIds.every((id) => ids.has(id))) {
      console.error('reorderMoves: invalid order payload', newOrderIds);
      return;
    }
    this.data.moveOrder = newOrderIds;
    this.emit();
  }

  // ---- Max tests ----
  setMaxTest(moveId, reps, band = 'none') {
    const testedAt = new Date().toISOString();
    this.data.maxTests[moveId] = { reps, band, testedAt };
    this.queue({ table: 'max_tests', type: 'upsert', row: { move_id: moveId, reps, band, tested_at: testedAt } });
    // A max test is also a real set performed — log it in history too.
    this.logSession(moveId, reps, band, { isMaxTest: true });
  }

  // ---- Sessions (one entry per set) ----
  logSession(moveId, reps, band = 'none', { isMaxTest = false } = {}) {
    const entry = { id: uid(), moveId, reps, band, loggedAt: new Date().toISOString(), isMaxTest };
    this.data.sessions.push(entry);
    this.queue({ table: 'sessions', type: 'insert', row: { id: entry.id, move_id: moveId, reps, band, logged_at: entry.loggedAt } });
    this.emit();
    return entry;
  }

  deleteSession(sessionId) {
    this.data.sessions = this.data.sessions.filter((s) => s.id !== sessionId);
    this.queue({ table: 'sessions', type: 'delete', row: { id: sessionId } });
    this.emit();
  }

  sessionsForMove(moveId) {
    return this.data.sessions.filter((s) => s.moveId === moveId).sort((a, b) => new Date(b.loggedAt) - new Date(a.loggedAt));
  }

  // Sessions bucketed by calendar day (most recent day first, most recent set first within a day).
  groupedHistory() {
    const byDay = {};
    for (const s of this.data.sessions) {
      const day = s.loggedAt.slice(0, 10);
      (byDay[day] = byDay[day] || []).push(s);
    }
    return Object.keys(byDay)
      .sort((a, b) => b.localeCompare(a))
      .map((day) => ({
        day,
        sessions: byDay[day].sort((a, b) => new Date(b.loggedAt) - new Date(a.loggedAt)),
      }));
  }

  // ---- Settings ----
  updateSettings(patch) {
    this.data.settings = { ...this.data.settings, ...patch };
    this.queue({
      table: 'settings',
      type: 'upsert',
      row: {
        rest_seconds: this.data.settings.restSeconds,
        sound_on: this.data.settings.soundOn,
        vibrate_on: this.data.settings.vibrateOn,
        last_deload: this.data.settings.lastDeload,
      },
    });
    this.emit();
  }

  markDeload() {
    this.updateSettings({ lastDeload: Date.now() });
  }

  // ---- Plan logic ----
  getTarget(moveId) {
    const max = this.data.maxTests[moveId];
    if (!max) return null;
    const reps = Math.max(1, Math.round(max.reps * 0.75));
    const sets = max.reps < 8 ? 3 : 4;
    return { reps, sets, basedOnBand: max.band };
  }

  getPlanStatus(moveId) {
    const move = this.data.moves.find((m) => m.id === moveId);
    const target = this.getTarget(moveId);
    if (!move || !target) return { hasMaxTest: false };

    const sessions = this.sessionsForMove(moveId);
    const byDay = {};
    for (const s of sessions) {
      const day = s.loggedAt.slice(0, 10);
      (byDay[day] = byDay[day] || []).push(s);
    }
    const days = Object.keys(byDay).sort().reverse().slice(0, 2);
    const hitTargetOnDay = (day) => {
      const entries = byDay[day];
      return entries.length >= target.sets && entries.every((e) => e.reps >= target.reps);
    };
    const readyToRetest = days.length === 2 && days.every(hitTargetOnDay);

    let suggestion = null;
    if (readyToRetest) {
      if (move.isAssistable && target.basedOnBand && target.basedOnBand !== 'none') {
        const order = ['red', 'yellow', 'blue', 'none'];
        const next = order[order.indexOf(target.basedOnBand) + 1];
        suggestion = next ? `Nailing it — retest with a lighter band (${BANDS[next].label}).` : 'Nailing it — retest unassisted, or add weight.';
      } else if (!move.isAssistable) {
        suggestion = 'Nailing it — retest, try a harder variation, or add weight.';
      } else {
        suggestion = 'Nailing it — time to retest your max.';
      }
    }

    return { hasMaxTest: true, target, readyToRetest, suggestion };
  }

  needsDeload() {
    const last = this.data.settings.lastDeload || Date.now();
    return Date.now() - last > 35 * DAY_MS;
  }

  // ---- Focus program (adapts to recent training days) ----
  getFocusProgram(moveName = FOCUS_MOVE_NAME) {
    const move = this.data.moves.find((m) => m.name === moveName);
    if (!move) return { status: 'missing', moveName };

    if (this.needsDeload()) return { status: 'deload', move };

    const status = this.getPlanStatus(move.id);
    if (!status.hasMaxTest) return { status: 'needs-baseline', move };

    if (status.readyToRetest) return { status: 'retest', move, target: status.target };

    const sessions = this.sessionsForMove(move.id);
    const last = sessions[0];
    const daysSince = last ? Math.floor((Date.now() - new Date(last.loggedAt).getTime()) / DAY_MS) : Infinity;

    const accessory = this.pickAccessory(move.id);

    let action;
    if (daysSince === 0) action = 'trained-today';
    else if (daysSince === 1) action = 'recovery';
    else action = 'train';

    return { status: action, move, target: status.target, daysSince, accessory };
  }

  pickAccessory(excludeMoveId) {
    const candidates = this.data.moves.filter(
      (m) => m.id !== excludeMoveId && ACCESSORY_MOVE_NAMES.includes(m.name)
    );
    if (!candidates.length) return null;
    return candidates
      .map((m) => ({ move: m, lastAt: this.sessionsForMove(m.id)[0]?.loggedAt || null }))
      .sort((a, b) => new Date(a.lastAt || 0) - new Date(b.lastAt || 0))[0].move;
  }
}

export const store = new Store();
