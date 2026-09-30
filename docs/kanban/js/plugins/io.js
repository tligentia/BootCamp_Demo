// Importar / exportar: JSON (tablero o copia completa) y CSV.

import { download, pickFile } from '../dom.js';

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

export function boardToCsv(board) {
  const head = ['Columna', 'Título', 'Descripción', 'Prioridad', 'Responsable', 'Fecha límite', 'Etiquetas', 'Checklist', 'Creada', 'Completada'];
  const rows = [head];
  for (const col of board.columns) {
    for (const id of col.cards) {
      const c = board.cards[id];
      const labels = c.labels.map((l) => (board.labels.find((x) => x.id === l) || {}).name).filter(Boolean).join('; ');
      const done = c.checklist.filter((i) => i.done).length;
      rows.push([
        col.title, c.title, c.desc, c.priority, c.assignee, c.due, labels,
        c.checklist.length ? `${done}/${c.checklist.length}` : '',
        new Date(c.created).toISOString(), c.completed ? new Date(c.completed).toISOString() : '',
      ]);
    }
  }
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tablero';

export default {
  id: 'io',
  name: 'Importar y exportar',
  description: 'Exporta el tablero a JSON o CSV e importa copias de seguridad.',
  toolbar: [
    {
      id: 'export-json',
      label: 'Exportar JSON',
      title: 'Descargar el tablero actual',
      onClick: (api) => download(`${slug(api.store.board.name)}.json`, JSON.stringify(api.store.board, null, 2)),
    },
    {
      id: 'export-csv',
      label: 'Exportar CSV',
      title: 'Descargar las tarjetas en CSV',
      onClick: (api) => download(`${slug(api.store.board.name)}.csv`, boardToCsv(api.store.board), 'text/csv;charset=utf-8'),
    },
    {
      id: 'backup',
      label: 'Copia total',
      title: 'Descargar todos los tableros',
      onClick: (api) => download('kanban-copia.json', JSON.stringify(api.store.state, null, 2)),
    },
    {
      id: 'import',
      label: 'Importar',
      title: 'Importar un tablero o una copia total (JSON)',
      async onClick(api) {
        const file = await pickFile('.json,application/json');
        if (!file) return;
        let data;
        try {
          data = JSON.parse(file.text);
        } catch {
          return api.toast('El archivo no es un JSON válido');
        }
        if (data && data.boards) {
          if (!(await api.confirm('Esto reemplazará todos los tableros actuales (se puede deshacer). ¿Continuar?'))) return;
          const r = api.store.dispatch('importAll', { state: data });
          if (r.ok) api.toast('Copia importada');
        } else {
          const r = api.store.dispatch('importBoard', { board: data });
          if (r.ok) api.toast('Tablero importado');
        }
      },
    },
  ],
};
