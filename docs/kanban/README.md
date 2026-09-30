# Kanban

Aplicación estática (HTML + ES modules, sin dependencias ni build). Se sirve desde cualquier servidor estático (p. ej. `python3 -m http.server -d docs`) o GitHub Pages en `/kanban/`.

## Funciones del núcleo
- Varios tableros, columnas (crear, editar, reordenar, eliminar, marcar como "final"), tarjetas con descripción, prioridad, responsable, fecha límite, etiquetas y checklist.
- Arrastrar y soltar tarjetas y columnas; alta rápida (`n`), búsqueda (`/`), filtros por prioridad, etiqueta y vencidas.
- Deshacer / rehacer (Ctrl+Z, Ctrl+Shift+Z), persistencia en `localStorage`, sincronización entre pestañas.

## Arquitectura
- `js/store.js`: estado y acciones transaccionales (`dispatch`). Cada acción trabaja sobre un borrador; si un hook la veta o falla, no se aplica nada.
- `js/plugins.js`: host de plugins. `js/plugins/*`: plugins incluidos (métricas, automatizaciones, actividad, límites WIP, importar/exportar).
- `js/app.js`: interfaz.

## Crear un plugin
```js
window.kanban.host.register({
  id: 'mi-plugin',
  name: 'Mi plugin',
  hooks: {
    before: { moveCard: (ctx) => ctx.payload.to === 'x' ? { cancel: true, reason: 'No permitido' } : undefined },
    after:  { '*': (ctx, result) => { /* puede mutar ctx.state; entra en el mismo deshacer */ } },
  },
  cardFields: [{ key: 'puntos', label: 'Puntos', type: 'number' }],  // se guarda en card.meta
  columnFields: [{ key: 'sla', label: 'SLA (h)', type: 'number' }],  // se guarda en column.meta
  cardBadges: (card) => card.meta.puntos ? [{ text: card.meta.puntos + ' pts' }] : [],
  toolbar: [{ id: 'hola', label: 'Hola', onClick: (api) => api.toast('Hola') }],
  panels: [{ id: 'p', title: 'Panel', render: (el, api) => el.append(api.h('p', {}, 'Contenido')) }],
});
```
Los plugins incluidos se registran en `js/plugins/index.js`. Cada uno se activa o desactiva en Paneles > Plugins.

## Pruebas
`node --test tests/kanban.test.mjs` (núcleo y plugins, sin navegador).
