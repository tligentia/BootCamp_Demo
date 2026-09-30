// Host de plugins. Un plugin es un objeto:
//   {
//     id, name, description,
//     hooks:        { before: { acción|'*': (ctx, api) => {cancel, reason}? },
//                     after:  { acción|'*': (ctx, result, api) => void } },
//     columnFields: [{ key, label, type: 'text'|'number'|'select'|'date', options? }]   -> column.meta[key]
//     cardFields:   [...]                                                                 -> card.meta[key]
//     cardBadges:   (card, column, board) => [{ text, tone?: 'red'|'gray'|'black', title? }]
//     columnBadges: (column, board) => [...]
//     toolbar:      [{ id, label, title?, onClick(api) }]
//     panels:       [{ id, title, render(el, api) }]
//     init(api)
//   }
// Los hooks se ejecutan dentro de la transacción de la acción: sus mutaciones
// entran en el mismo paso de deshacer.

export function createHost(store, api, storage = null, storageKey = 'kanban.plugins') {
  const plugins = [];
  let off = new Set();
  if (storage) {
    try {
      off = new Set(JSON.parse(storage.getItem(storageKey) || '[]'));
    } catch {
      off = new Set();
    }
  }
  const isEnabled = (id) => !off.has(id);

  function register(p) {
    if (!p.id || plugins.some((x) => x.id === p.id)) throw new Error(`Plugin inválido o duplicado: ${p.id}`);
    plugins.push(p);
    for (const phase of ['before', 'after']) {
      for (const [name, fn] of Object.entries((p.hooks && p.hooks[phase]) || {})) {
        store.hook(phase, name, (ctx, res) => (isEnabled(p.id) ? fn(ctx, phase === 'after' ? res : api, api) : undefined));
      }
    }
    if (p.init) p.init(api);
    return host;
  }

  function setEnabled(id, on) {
    if (on) off.delete(id);
    else off.add(id);
    if (storage) {
      try {
        storage.setItem(storageKey, JSON.stringify([...off]));
      } catch {
        /* ignorar */
      }
    }
  }

  const active = () => plugins.filter((p) => isEnabled(p.id));
  const collect = (key) => active().flatMap((p) => (p[key] || []).map((x) => ({ ...x, plugin: p.id })));
  const badges = (key, ...args) =>
    active().flatMap((p) => {
      try {
        return (p[key] && p[key](...args)) || [];
      } catch {
        return [];
      }
    });

  const host = { register, setEnabled, isEnabled, list: () => plugins, collect, badges };
  return host;
}
