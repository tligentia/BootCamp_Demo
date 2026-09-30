// Registro de actividad del tablero (board.meta.activity, máx. 150 entradas).

import { h, fmtDateTime } from '../dom.js';
import { findCard } from '../store.js';

const MAX = 150;

function describe(ctx, result) {
  const { name, payload, board } = ctx;
  const colTitle = (id) => (board.columns.find((c) => c.id === id) || { title: '?' }).title;
  const cardTitle = (id) => (board.cards[id] || { title: '?' }).title;
  switch (name) {
    case 'addCard':
      return `Tarjeta creada: "${cardTitle(result.id)}" en ${colTitle(result.col)}`;
    case 'moveCard':
      return result.from === result.to ? null : `"${cardTitle(result.id)}": ${colTitle(result.from)} a ${colTitle(result.to)}`;
    case 'deleteCard':
      return 'Tarjeta eliminada';
    case 'updateCard':
      return findCard(board, payload.id) ? `Tarjeta editada: "${cardTitle(payload.id)}"` : null;
    case 'addColumn':
      return `Columna creada: "${colTitle(result.id)}"`;
    case 'deleteColumn':
      return 'Columna eliminada';
    case 'updateColumn':
      return `Columna editada: "${colTitle(payload.id)}"`;
    default:
      return null;
  }
}

export default {
  id: 'activity',
  name: 'Actividad',
  description: 'Historial cronológico de cambios del tablero.',
  hooks: {
    after: {
      '*': (ctx, result) => {
        if (ctx.name === 'setBoardMeta' || !ctx.board) return;
        const text = describe(ctx, result || {});
        if (!text) return;
        const log = Array.isArray(ctx.board.meta.activity) ? ctx.board.meta.activity : [];
        ctx.board.meta.activity = [{ t: ctx.now, text }, ...log].slice(0, MAX);
      },
    },
  },
  panels: [
    {
      id: 'activity',
      title: 'Actividad',
      render(el, api) {
        const log = api.store.board.meta.activity || [];
        el.append(
          log.length
            ? h('ul', { class: 'plain log' }, log.map((e) => h('li', {}, h('time', {}, fmtDateTime(e.t)), h('span', {}, e.text))))
            : h('p', { class: 'muted' }, 'Todavía no hay actividad registrada.'),
        );
      },
    },
  ],
};
