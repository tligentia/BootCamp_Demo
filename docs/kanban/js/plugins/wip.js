// Límite de trabajo en curso (WIP) por columna. Bloquea o avisa según el modo.

export default {
  id: 'wip',
  name: 'Límites WIP',
  description: 'Limita el número de tarjetas por columna y bloquea los movimientos que lo superen.',
  columnFields: [{ key: 'wip', label: 'Límite WIP (vacío = sin límite)', type: 'number' }],
  hooks: {
    before: {
      moveCard(ctx) {
        const { id, to } = ctx.payload;
        const col = ctx.board.columns.find((c) => c.id === to);
        const limit = col && Number(col.meta.wip);
        if (!limit || col.cards.includes(id)) return; // reordenar dentro de la misma columna siempre es válido
        if (col.cards.length >= limit) return { cancel: true, reason: `Límite WIP alcanzado en "${col.title}" (${limit})` };
      },
      addCard(ctx) {
        const col = ctx.board.columns.find((c) => c.id === ctx.payload.col);
        const limit = col && Number(col.meta.wip);
        if (limit && col.cards.length >= limit) return { cancel: true, reason: `Límite WIP alcanzado en "${col.title}" (${limit})` };
      },
    },
  },
  columnBadges(col) {
    const limit = Number(col.meta.wip);
    if (!limit) return [];
    const n = col.cards.length;
    return [{ text: `${n}/${limit}`, tone: n >= limit ? 'red' : 'gray', title: 'Tarjetas / límite WIP' }];
  },
};
