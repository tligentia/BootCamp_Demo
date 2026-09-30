// Reglas "cuando una tarjeta entra en una columna, entonces ...".
// Se guardan en board.meta.automations = [{ id, col, action, value }].

import { h } from '../dom.js';
import { uid, PRIORITIES } from '../store.js';

export const ACTIONS = {
  priority: { label: 'Establecer prioridad', options: PRIORITIES.filter((p) => p !== 'none') },
  assignee: { label: 'Asignar a', text: true },
  addLabel: { label: 'Añadir etiqueta', labels: true },
  clearDue: { label: 'Quitar fecha límite', none: true },
  dueIn: { label: 'Fecha límite en N días', number: true },
};

export function applyRule(card, rule, board) {
  switch (rule.action) {
    case 'priority':
      if (PRIORITIES.includes(rule.value)) card.priority = rule.value;
      break;
    case 'assignee':
      card.assignee = String(rule.value || '');
      break;
    case 'addLabel':
      if (board.labels.some((l) => l.id === rule.value) && !card.labels.includes(rule.value)) card.labels.push(rule.value);
      break;
    case 'clearDue':
      card.due = '';
      break;
    case 'dueIn': {
      const n = Number(rule.value);
      if (Number.isFinite(n)) card.due = new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
      break;
    }
  }
}

const rulesOf = (board) => (Array.isArray(board.meta.automations) ? board.meta.automations : []);

function run(ctx, result) {
  const { board } = ctx;
  const id = result && result.id;
  const to = ctx.name === 'moveCard' ? result && result.to : result && result.col;
  if (!id || !to) return;
  if (ctx.name === 'moveCard' && result.from === result.to) return;
  const card = board.cards[id];
  for (const rule of rulesOf(board)) if (rule.col === to && card) applyRule(card, rule, board);
}

export default {
  id: 'automations',
  name: 'Automatizaciones',
  description: 'Acciones automáticas al entrar una tarjeta en una columna.',
  hooks: { after: { moveCard: run, addCard: run } },
  panels: [
    {
      id: 'automations',
      title: 'Automatizaciones',
      render(el, api) {
        const board = api.store.board;
        const rules = rulesOf(board);
        const colName = (id) => (board.columns.find((c) => c.id === id) || { title: '(eliminada)' }).title;
        const describe = (r) => {
          const a = ACTIONS[r.action];
          const label = r.action === 'addLabel' ? (board.labels.find((l) => l.id === r.value) || { name: '?' }).name : r.value;
          return `Al entrar en "${colName(r.col)}": ${a ? a.label : r.action}${a && !a.none ? ' = ' + label : ''}`;
        };
        const save = (list) => api.store.dispatch('setBoardMeta', { key: 'automations', value: list });

        const colSel = h('select', {}, board.columns.map((c) => h('option', { value: c.id }, c.title)));
        const actSel = h('select', {}, Object.entries(ACTIONS).map(([k, a]) => h('option', { value: k }, a.label)));
        const valBox = h('span');
        let valEl;
        const buildVal = () => {
          const a = ACTIONS[actSel.value];
          valBox.replaceChildren();
          valEl = null;
          if (a.options) valEl = h('select', {}, a.options.map((o) => h('option', { value: o }, api.priorityLabel(o))));
          else if (a.labels) valEl = h('select', {}, board.labels.map((l) => h('option', { value: l.id }, l.name)));
          else if (a.number) valEl = h('input', { type: 'number', value: '1', min: '0' });
          else if (a.text) valEl = h('input', { type: 'text', placeholder: 'Nombre' });
          if (valEl) valBox.append(valEl);
        };
        actSel.addEventListener('change', buildVal);
        buildVal();

        el.append(
          h('p', { class: 'hint' }, 'Las reglas se aplican cuando una tarjeta se crea o se mueve a la columna indicada.'),
          h('div', { class: 'stack' },
            h('label', {}, 'Columna', colSel),
            h('label', {}, 'Acción', actSel),
            h('label', {}, 'Valor', valBox),
            h('button', {
              class: 'btn primary',
              onClick: () => save([...rules, { id: uid('r'), col: colSel.value, action: actSel.value, value: valEl ? valEl.value : '' }]),
            }, 'Añadir regla'),
          ),
          h('ul', { class: 'plain' },
            rules.length ? rules.map((r) => h('li', {}, h('span', {}, describe(r)),
              h('button', { class: 'btn small', onClick: () => save(rules.filter((x) => x.id !== r.id)) }, 'Eliminar')))
              : h('li', { class: 'muted' }, 'Sin reglas definidas.')),
        );
      },
    },
  ],
};
