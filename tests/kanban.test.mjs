import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, findCard, normalizeState } from '../docs/kanban/js/store.js';
import { createHost } from '../docs/kanban/js/plugins.js';
import wip from '../docs/kanban/js/plugins/wip.js';
import automations from '../docs/kanban/js/plugins/automations.js';
import activity from '../docs/kanban/js/plugins/activity.js';
import metrics, { computeMetrics } from '../docs/kanban/js/plugins/metrics.js';
import { boardToCsv } from '../docs/kanban/js/plugins/io.js';

const mem = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
};
const setup = (...plugins) => {
  const store = createStore({ storage: mem() });
  const api = { store };
  const host = createHost(store, api);
  plugins.forEach((p) => host.register(p));
  return { store, host };
};
const cols = (s) => s.board.columns;

test('seed, persistencia y recarga', () => {
  const storage = mem();
  const a = createStore({ storage });
  a.dispatch('addBoard', { name: 'Otro' });
  const b = createStore({ storage });
  assert.equal(Object.keys(b.state.boards).length, 2);
  assert.equal(b.board.name, 'Otro');
});

test('mover tarjetas: entre columnas, orden y completed', () => {
  const { store } = setup();
  const [todo, , done] = cols(store);
  const id = todo.cards[0];
  store.dispatch('moveCard', { id, to: done.id, before: null });
  const b = store.board;
  assert.equal(b.columns[2].cards.at(-1), id);
  assert.ok(b.cards[id].completed);
  store.dispatch('moveCard', { id, to: todo.id, before: todo.cards[1] });
  assert.equal(store.board.columns[0].cards.indexOf(id), 0);
  assert.equal(store.board.cards[id].completed, null);
});

test('undo/redo y acciones sin historial', () => {
  const { store } = setup();
  const n = cols(store)[0].cards.length;
  store.dispatch('addCard', { col: cols(store)[0].id, card: { title: 'X' } });
  assert.equal(cols(store)[0].cards.length, n + 1);
  store.dispatch('selectBoard', { id: store.board.id });
  assert.ok(store.undo());
  assert.equal(cols(store)[0].cards.length, n);
  assert.ok(store.redo());
  assert.equal(cols(store)[0].cards.length, n + 1);
  assert.equal(store.redo(), false);
});

test('WIP bloquea movimientos y altas, pero no reordenar', () => {
  const { store } = setup(wip);
  const [todo, doing] = cols(store); // doing: wip=3 con 1 tarjeta
  for (let i = 0; i < 2; i++) assert.ok(store.dispatch('addCard', { col: doing.id, card: { title: 'w' + i } }).ok);
  const r = store.dispatch('moveCard', { id: todo.cards[0], to: doing.id });
  assert.equal(r.ok, false);
  assert.match(r.reason, /WIP/);
  assert.equal(store.dispatch('addCard', { col: doing.id, card: { title: 'z' } }).ok, false);
  const inner = store.board.columns[1].cards;
  assert.ok(store.dispatch('moveCard', { id: inner[2], to: doing.id, before: inner[0] }).ok);
});

test('plugin desactivado no ejecuta hooks', () => {
  const { store, host } = setup(wip);
  host.setEnabled('wip', false);
  const [todo, doing] = cols(store);
  for (let i = 0; i < 5; i++) assert.ok(store.dispatch('addCard', { col: doing.id, card: { title: 'w' } }).ok);
  assert.ok(store.dispatch('moveCard', { id: todo.cards[0], to: doing.id }).ok);
});

test('automatizaciones se aplican en la misma transacción (un solo undo)', () => {
  const { store } = setup(automations);
  const [todo, doing] = cols(store);
  store.dispatch('setBoardMeta', { key: 'automations', value: [
    { id: 'r1', col: doing.id, action: 'priority', value: 'urgent' },
    { id: 'r2', col: doing.id, action: 'assignee', value: 'Eva' },
  ] });
  const id = todo.cards[1];
  store.dispatch('moveCard', { id, to: doing.id });
  assert.equal(store.board.cards[id].priority, 'urgent');
  assert.equal(store.board.cards[id].assignee, 'Eva');
  store.undo();
  assert.notEqual(store.board.cards[id].assignee, 'Eva');
  assert.equal(findCard(store.board, id).col.id, todo.id);
});

test('actividad registra y limita', () => {
  const { store } = setup(activity);
  store.dispatch('addCard', { col: cols(store)[0].id, card: { title: 'A' } });
  assert.match(store.board.meta.activity[0].text, /Tarjeta creada/);
  for (let i = 0; i < 200; i++) store.dispatch('addCard', { col: cols(store)[2].id, card: { title: 'n' + i } });
  assert.equal(store.board.meta.activity.length, 150);
});

test('eliminar columna, etiquetas y tablero', () => {
  const { store } = setup();
  const lab = store.board.labels[0].id;
  store.dispatch('deleteLabel', { id: lab });
  assert.ok(Object.values(store.board.cards).every((c) => !c.labels.includes(lab)));
  store.dispatch('deleteColumn', { id: cols(store)[0].id });
  assert.equal(cols(store).length, 2);
  assert.equal(store.dispatch('deleteBoard', {}).ok, false); // último tablero
});

test('moveColumn reordena', () => {
  const { store } = setup();
  const [a, b, c] = cols(store).map((x) => x.id);
  store.dispatch('moveColumn', { id: c, before: a });
  assert.deepEqual(cols(store).map((x) => x.id), [c, a, b]);
  store.dispatch('moveColumn', { id: c, before: null });
  assert.deepEqual(cols(store).map((x) => x.id), [a, b, c]);
});

test('import valida y normaliza; rechaza basura', () => {
  const { store } = setup();
  assert.equal(store.dispatch('importBoard', { board: { foo: 1 } }).ok, false);
  assert.equal(store.dispatch('importAll', { state: { boards: {} } }).ok, false);
  const exported = JSON.parse(JSON.stringify(store.board));
  assert.ok(store.dispatch('importBoard', { board: exported }).ok);
  assert.equal(Object.keys(store.state.boards).length, 2);
  const s = normalizeState({ boards: { x: { name: 'x', columns: [{ id: 'c', title: 'c', cards: ['ghost'] }] } } });
  assert.equal(s.boards.x.columns[0].cards.length, 0);
});

test('métricas y CSV', () => {
  const { store } = setup(metrics);
  const m = computeMetrics(store.board);
  assert.equal(m.total, 5);
  assert.equal(m.completed, 1);
  assert.equal(m.overdue, 1);
  const csv = boardToCsv(store.board);
  assert.equal(csv.split('\r\n').length, 6);
  assert.ok(csv.includes('Corregir fallo de login'));
});
