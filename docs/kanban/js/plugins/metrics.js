// Panel de métricas: flujo, vencimientos, carga y tiempo de ciclo.

import { h, today } from '../dom.js';

export function computeMetrics(board, now = Date.now()) {
  const t = new Date(now).toISOString().slice(0, 10);
  const cards = Object.values(board.cards);
  const doneCols = new Set(board.columns.filter((c) => c.done).map((c) => c.id));
  const perColumn = board.columns.map((c) => ({ id: c.id, title: c.title, count: c.cards.length, done: c.done }));
  const doneIds = new Set(board.columns.filter((c) => c.done).flatMap((c) => c.cards));
  const open = cards.filter((c) => !doneIds.has(c.id));
  const completed = cards.filter((c) => doneIds.has(c.id));
  const cycle = completed.filter((c) => c.completed).map((c) => c.completed - c.created);
  const week = completed.filter((c) => c.completed && now - c.completed <= 7 * 864e5).length;
  const byPriority = {};
  const byAssignee = {};
  for (const c of open) {
    byPriority[c.priority] = (byPriority[c.priority] || 0) + 1;
    const who = c.assignee || 'Sin asignar';
    byAssignee[who] = (byAssignee[who] || 0) + 1;
  }
  return {
    total: cards.length,
    open: open.length,
    completed: completed.length,
    overdue: open.filter((c) => c.due && c.due < t).length,
    dueToday: open.filter((c) => c.due === t).length,
    completedLast7: week,
    avgCycleDays: cycle.length ? cycle.reduce((a, b) => a + b, 0) / cycle.length / 864e5 : null,
    perColumn,
    byPriority,
    byAssignee,
    hasDone: doneCols.size > 0,
  };
}

const bar = (label, value, max, red) =>
  h('div', { class: 'bar-row' },
    h('span', { class: 'bar-label' }, label),
    h('span', { class: 'bar-track' }, h('span', { class: 'bar-fill' + (red ? ' red' : ''), style: { width: max ? `${(value / max) * 100}%` : '0%' } })),
    h('span', { class: 'bar-value' }, String(value)));

export default {
  id: 'metrics',
  name: 'Métricas',
  description: 'Estadísticas del tablero: flujo por columna, vencimientos, carga por persona y tiempo de ciclo.',
  panels: [
    {
      id: 'metrics',
      title: 'Métricas',
      render(el, api) {
        const m = computeMetrics(api.store.board);
        const kpi = (v, l, red) => h('div', { class: 'kpi' + (red ? ' red' : '') }, h('strong', {}, String(v)), h('span', {}, l));
        const maxCol = Math.max(1, ...m.perColumn.map((c) => c.count));
        const maxAss = Math.max(1, ...Object.values(m.byAssignee));
        el.append(h('div', { class: 'metrics' },
          h('div', { class: 'kpis' },
            kpi(m.total, 'Tarjetas'),
            kpi(m.open, 'Abiertas'),
            kpi(m.completed, 'Completadas'),
            kpi(m.overdue, 'Vencidas', m.overdue > 0),
            kpi(m.dueToday, 'Vencen hoy'),
            kpi(m.avgCycleDays == null ? '-' : m.avgCycleDays.toFixed(1) + ' d', 'Ciclo medio')),
          h('h4', {}, 'Tarjetas por columna'),
          m.perColumn.map((c) => bar(c.title, c.count, maxCol, false)),
          h('h4', {}, 'Carga abierta por persona'),
          Object.keys(m.byAssignee).length
            ? Object.entries(m.byAssignee).sort((a, b) => b[1] - a[1]).map(([k, v]) => bar(k, v, maxAss, false))
            : h('p', { class: 'muted' }, 'Sin tarjetas abiertas.'),
          h('h4', {}, 'Abiertas por prioridad'),
          ['urgent', 'high', 'medium', 'low', 'none'].map((p) => bar(api.priorityLabel(p), m.byPriority[p] || 0, Math.max(1, m.open), p === 'urgent')),
          h('p', { class: 'hint' }, `Completadas en los últimos 7 días: ${m.completedLast7}. Fecha de referencia: ${today()}.`),
        ));
      },
    },
  ],
};
