// Núcleo del kanban: estado, acciones transaccionales, hooks, undo/redo y persistencia.
// Sin dependencias del DOM: se puede probar en Node.

export const VERSION = 1;
export const PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'];
export const LABEL_COLORS = ['black', 'red', 'gray'];

export const uid = (p = 'x') =>
  p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);

export class KanbanError extends Error {}

const fail = (msg) => {
  throw new KanbanError(msg);
};

// ---------- Modelo ----------

export function newBoard(name = 'Tablero', withColumns = true) {
  const b = { id: uid('b'), name, created: Date.now(), labels: [], columns: [], cards: {}, meta: {} };
  if (withColumns) {
    b.columns = [
      { id: uid('c'), title: 'Por hacer', done: false, cards: [], meta: {} },
      { id: uid('c'), title: 'En curso', done: false, cards: [], meta: {} },
      { id: uid('c'), title: 'Hecho', done: true, cards: [], meta: {} },
    ];
  }
  return b;
}

export function newCard(data = {}) {
  const now = Date.now();
  return {
    id: uid('t'),
    title: String(data.title || '').trim() || 'Sin título',
    desc: data.desc || '',
    labels: data.labels || [],
    priority: PRIORITIES.includes(data.priority) ? data.priority : 'none',
    assignee: data.assignee || '',
    due: data.due || '',
    checklist: data.checklist || [],
    meta: data.meta || {},
    created: now,
    updated: now,
    completed: null,
  };
}

export function seedState() {
  const b = newBoard('Proyecto demo');
  const [todo, doing, done] = b.columns;
  doing.meta.wip = 3;
  b.labels = [
    { id: 'l-bug', name: 'Error', color: 'red' },
    { id: 'l-feat', name: 'Mejora', color: 'black' },
    { id: 'l-doc', name: 'Documentación', color: 'gray' },
  ];
  const add = (col, data) => {
    const c = newCard(data);
    b.cards[c.id] = c;
    col.cards.push(c.id);
    if (col.done) c.completed = Date.now();
  };
  const day = 864e5;
  const iso = (d) => new Date(Date.now() + d * day).toISOString().slice(0, 10);
  add(todo, { title: 'Definir alcance del sprint', priority: 'high', labels: ['l-feat'], due: iso(2), assignee: 'Ana' });
  add(todo, { title: 'Redactar guía de uso', priority: 'low', labels: ['l-doc'] });
  add(todo, { title: 'Corregir fallo de login', priority: 'urgent', labels: ['l-bug'], due: iso(-1), assignee: 'Luis' });
  add(doing, {
    title: 'Diseñar tablero de métricas',
    priority: 'medium',
    labels: ['l-feat'],
    assignee: 'Marta',
    checklist: [
      { id: uid('i'), text: 'Wireframe', done: true },
      { id: uid('i'), text: 'Revisión con cliente', done: false },
    ],
  });
  add(done, { title: 'Configurar repositorio', priority: 'none' });
  return { version: VERSION, activeBoard: b.id, boards: { [b.id]: b } };
}

export function normalizeBoard(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.columns)) fail('Tablero no válido');
  const b = newBoard(String(raw.name || 'Tablero'), false);
  b.labels = (raw.labels || [])
    .filter((l) => l && l.id)
    .map((l) => ({ id: String(l.id), name: String(l.name || ''), color: LABEL_COLORS.includes(l.color) ? l.color : 'gray' }));
  b.meta = raw.meta && typeof raw.meta === 'object' ? raw.meta : {};
  for (const rc of raw.columns) {
    const col = { id: String(rc.id || uid('c')), title: String(rc.title || 'Columna'), done: !!rc.done, cards: [], meta: rc.meta || {} };
    for (const id of rc.cards || []) {
      const rcard = raw.cards && raw.cards[id];
      if (!rcard) continue;
      const card = { ...newCard(rcard), id: String(id) };
      card.created = Number(rcard.created) || card.created;
      card.updated = Number(rcard.updated) || card.updated;
      card.completed = rcard.completed ? Number(rcard.completed) : null;
      card.labels = card.labels.filter((l) => b.labels.some((x) => x.id === l));
      b.cards[card.id] = card;
      col.cards.push(card.id);
    }
    b.columns.push(col);
  }
  return b;
}

export function normalizeState(raw) {
  if (!raw || typeof raw !== 'object' || !raw.boards || typeof raw.boards !== 'object') fail('Estado no válido');
  const boards = {};
  for (const [id, rb] of Object.entries(raw.boards)) {
    const b = normalizeBoard(rb);
    b.id = id;
    boards[id] = b;
  }
  const ids = Object.keys(boards);
  if (!ids.length) fail('No hay tableros');
  return { version: VERSION, activeBoard: boards[raw.activeBoard] ? raw.activeBoard : ids[0], boards };
}

export function findCard(board, id) {
  for (const col of board.columns) if (col.cards.includes(id)) return { col, card: board.cards[id] };
  return null;
}
const getCol = (board, id) => board.columns.find((c) => c.id === id) || fail('Columna inexistente');

// ---------- Acciones ----------
// Cada acción muta un borrador (ctx.state) dentro de una transacción.
// history:false -> no entra en el historial de deshacer.

const actions = {
  selectBoard: {
    history: false,
    run({ state, payload }) {
      if (!state.boards[payload.id]) fail('Tablero inexistente');
      state.activeBoard = payload.id;
    },
  },
  addBoard: {
    run({ state, payload }) {
      const b = newBoard(String(payload.name || '').trim() || 'Tablero');
      state.boards[b.id] = b;
      state.activeBoard = b.id;
      return { id: b.id };
    },
  },
  renameBoard: {
    run({ board, payload }) {
      board.name = String(payload.name || '').trim() || board.name;
    },
  },
  deleteBoard: {
    run({ state, payload }) {
      const id = payload.id || state.activeBoard;
      if (Object.keys(state.boards).length < 2) fail('Debe existir al menos un tablero');
      delete state.boards[id];
      if (state.activeBoard === id) state.activeBoard = Object.keys(state.boards)[0];
    },
  },
  setBoardMeta: {
    run({ board, payload }) {
      board.meta[payload.key] = payload.value;
    },
  },
  addColumn: {
    run({ board, payload }) {
      const col = { id: uid('c'), title: String(payload.title || '').trim() || 'Columna', done: !!payload.done, cards: [], meta: payload.meta || {} };
      board.columns.push(col);
      return { id: col.id };
    },
  },
  updateColumn: {
    run({ board, payload }) {
      const col = getCol(board, payload.id);
      const p = payload.patch || {};
      if (p.title !== undefined) col.title = String(p.title).trim() || col.title;
      if (p.done !== undefined) {
        col.done = !!p.done;
        for (const id of col.cards) board.cards[id].completed = col.done ? board.cards[id].completed || Date.now() : null;
      }
      if (p.meta) col.meta = { ...col.meta, ...p.meta };
    },
  },
  deleteColumn: {
    run({ board, payload }) {
      const col = getCol(board, payload.id);
      for (const id of col.cards) delete board.cards[id];
      board.columns = board.columns.filter((c) => c !== col);
    },
  },
  moveColumn: {
    run({ board, payload }) {
      const col = getCol(board, payload.id);
      board.columns = board.columns.filter((c) => c !== col);
      const at = payload.before ? board.columns.findIndex((c) => c.id === payload.before) : -1;
      board.columns.splice(at < 0 ? board.columns.length : at, 0, col);
    },
  },
  addCard: {
    run({ board, payload, now }) {
      const col = getCol(board, payload.col);
      const card = newCard(payload.card);
      card.labels = card.labels.filter((l) => board.labels.some((x) => x.id === l));
      board.cards[card.id] = card;
      if (payload.top) col.cards.unshift(card.id);
      else col.cards.push(card.id);
      if (col.done) card.completed = now;
      return { id: card.id, col: col.id };
    },
  },
  updateCard: {
    run({ board, payload, now }) {
      const hit = findCard(board, payload.id) || fail('Tarjeta inexistente');
      const p = payload.patch || {};
      const card = hit.card;
      for (const k of ['title', 'desc', 'assignee', 'due']) if (p[k] !== undefined) card[k] = String(p[k]);
      if (!card.title.trim()) card.title = 'Sin título';
      if (p.priority !== undefined && PRIORITIES.includes(p.priority)) card.priority = p.priority;
      if (p.labels) card.labels = p.labels.filter((l) => board.labels.some((x) => x.id === l));
      if (p.checklist) card.checklist = p.checklist.map((i) => ({ id: i.id || uid('i'), text: String(i.text || ''), done: !!i.done }));
      if (p.meta) card.meta = { ...card.meta, ...p.meta };
      card.updated = now;
    },
  },
  deleteCard: {
    run({ board, payload }) {
      const hit = findCard(board, payload.id) || fail('Tarjeta inexistente');
      hit.col.cards = hit.col.cards.filter((id) => id !== payload.id);
      delete board.cards[payload.id];
    },
  },
  moveCard: {
    // payload: { id, to: columnId, before?: cardId | null }
    run({ board, payload, now }) {
      const hit = findCard(board, payload.id) || fail('Tarjeta inexistente');
      const to = getCol(board, payload.to);
      const from = hit.col;
      from.cards = from.cards.filter((id) => id !== payload.id);
      const at = payload.before ? to.cards.indexOf(payload.before) : -1;
      to.cards.splice(at < 0 ? to.cards.length : at, 0, payload.id);
      hit.card.updated = now;
      if (from !== to) hit.card.completed = to.done ? hit.card.completed || now : null;
      return { id: payload.id, from: from.id, to: to.id };
    },
  },
  addLabel: {
    run({ board, payload }) {
      const name = String(payload.name || '').trim() || fail('Nombre de etiqueta vacío');
      const color = LABEL_COLORS.includes(payload.color) ? payload.color : 'gray';
      const l = { id: uid('l'), name, color };
      board.labels.push(l);
      return { id: l.id };
    },
  },
  deleteLabel: {
    run({ board, payload }) {
      board.labels = board.labels.filter((l) => l.id !== payload.id);
      for (const c of Object.values(board.cards)) c.labels = c.labels.filter((l) => l !== payload.id);
    },
  },
  importAll: {
    run({ state, payload }) {
      const s = normalizeState(payload.state);
      state.boards = s.boards;
      state.activeBoard = s.activeBoard;
    },
  },
  importBoard: {
    run({ state, payload }) {
      const b = normalizeBoard(payload.board);
      b.id = uid('b');
      state.boards[b.id] = b;
      state.activeBoard = b.id;
    },
  },
};

// ---------- Store ----------

export function createStore({ storage = null, key = 'kanban.v1', limit = 100 } = {}) {
  let state = null;
  if (storage) {
    try {
      const raw = storage.getItem(key);
      if (raw) state = normalizeState(JSON.parse(raw));
    } catch {
      state = null;
    }
  }
  if (!state) state = seedState();

  const past = [];
  const future = [];
  const listeners = new Map(); // evento -> Set
  const hooks = { before: new Map(), after: new Map() };

  const on = (ev, fn) => {
    if (!listeners.has(ev)) listeners.set(ev, new Set());
    listeners.get(ev).add(fn);
    return () => listeners.get(ev).delete(fn);
  };
  const emit = (ev, data) => (listeners.get(ev) || []).forEach((fn) => fn(data));

  const persist = () => {
    if (!storage) return;
    try {
      storage.setItem(key, JSON.stringify(state));
    } catch {
      emit('error', 'No se pudo guardar en el almacenamiento local');
    }
  };

  // Registra un hook. phase: 'before' | 'after'; name: acción o '*'.
  // before(ctx): devolver { cancel: true, reason } para vetar la acción.
  // after(ctx, result): puede mutar ctx.state y entra en la misma transacción.
  const hook = (phase, name, fn) => {
    const m = hooks[phase];
    if (!m.has(name)) m.set(name, []);
    m.get(name).push(fn);
  };
  const hooksFor = (phase, name) => [...(hooks[phase].get(name) || []), ...(hooks[phase].get('*') || [])];

  function dispatch(name, payload = {}) {
    const def = actions[name];
    if (!def) throw new Error(`Acción desconocida: ${name}`);
    const draft = structuredClone(state);
    const ctx = {
      name,
      payload,
      state: draft,
      now: Date.now(),
      get board() {
        return draft.boards[draft.activeBoard];
      },
    };
    try {
      for (const fn of hooksFor('before', name)) {
        const r = fn(ctx);
        if (r && r.cancel) throw new KanbanError(r.reason || 'Acción cancelada');
      }
      const result = def.run(ctx);
      for (const fn of hooksFor('after', name)) fn(ctx, result);
      const changed = JSON.stringify(draft) !== JSON.stringify(state);
      if (changed) {
        if (def.history !== false) {
          past.push(state);
          if (past.length > limit) past.shift();
          future.length = 0;
        }
        state = draft;
        persist();
        emit('change', { name, payload, result });
      }
      return { ok: true, result };
    } catch (e) {
      if (e instanceof KanbanError) {
        emit('rejected', { name, reason: e.message });
        return { ok: false, reason: e.message };
      }
      throw e;
    }
  }

  const swap = (from, to) => {
    if (!from.length) return false;
    to.push(state);
    state = from.pop();
    persist();
    emit('change', { name: 'history' });
    return true;
  };

  return {
    get state() {
      return state;
    },
    get board() {
      return state.boards[state.activeBoard];
    },
    dispatch,
    hook,
    on,
    undo: () => swap(past, future),
    redo: () => swap(future, past),
    get canUndo() {
      return past.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    },
    reload() {
      if (!storage) return;
      try {
        const raw = storage.getItem(key);
        if (raw) {
          state = normalizeState(JSON.parse(raw));
          emit('change', { name: 'reload' });
        }
      } catch {
        /* ignorar */
      }
    },
  };
}
