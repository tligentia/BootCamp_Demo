import { createStore, findCard, PRIORITIES, LABEL_COLORS } from './store.js';
import { createHost } from './plugins.js';
import builtin from './plugins/index.js';
import { h, today, fmtDate, initials } from './dom.js';

const PRIORITY_LABEL = { none: 'Sin prioridad', low: 'Baja', medium: 'Media', high: 'Alta', urgent: 'Urgente' };
const COLOR_LABEL = { black: 'Negro', red: 'Rojo', gray: 'Gris' };

let storage = null;
try {
  storage = window.localStorage;
  storage.getItem('kanban.probe');
} catch {
  storage = null;
}

const store = createStore({ storage });
const ui = { q: '', priority: '', label: '', overdue: false, composer: null, panel: null, drag: null };

// ---------- API pública para plugins ----------

const toasts = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
function toast(msg) {
  const t = h('div', { class: 'toast' }, msg);
  toasts.append(t);
  setTimeout(() => t.remove(), 3500);
}

const api = {
  store,
  h,
  toast,
  confirm: (msg) => confirmDialog(msg),
  openPanel: (id) => {
    ui.panel = id;
    render();
  },
  priorityLabel: (p) => PRIORITY_LABEL[p] || p,
};
const host = createHost(store, api, storage);
builtin.forEach((p) => host.register(p));
window.kanban = { store, host, api }; // punto de extensión: window.kanban.host.register(miPlugin)

store.on('change', () => render());
store.on('rejected', ({ reason }) => {
  toast(reason);
  render();
});
store.on('error', toast);
window.addEventListener('storage', (e) => e.key === 'kanban.v1' && store.reload());

// ---------- Diálogos ----------

function openDialog(build) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'dlg' });
    const close = (v) => {
      dlg.close();
      dlg.remove();
      resolve(v);
    };
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      close(null);
    });
    dlg.addEventListener('mousedown', (e) => e.target === dlg && close(null));
    dlg.append(build(close));
    document.body.append(dlg);
    dlg.showModal();
    const f = dlg.querySelector('[autofocus]') || dlg.querySelector('input,textarea,select');
    if (f) f.focus();
  });
}

const confirmDialog = (msg) =>
  openDialog((close) =>
    h('div', { class: 'dlg-body' },
      h('p', {}, msg),
      h('div', { class: 'row end' },
        h('button', { class: 'btn', onClick: () => close(false) }, 'Cancelar'),
        h('button', { class: 'btn danger', autofocus: true, onClick: () => close(true) }, 'Confirmar'))),
  ).then(Boolean);

function fieldEl(f, value) {
  const common = { id: 'f-' + f.key, name: f.key };
  if (f.type === 'select') {
    return h('select', common, (f.options || []).map((o) => h('option', { value: o.value ?? o, selected: String(o.value ?? o) === String(value ?? '') }, o.label ?? o)));
  }
  if (f.type === 'checkbox') return h('input', { ...common, type: 'checkbox', checked: !!value });
  if (f.type === 'textarea') return h('textarea', { ...common, rows: 4, value: value ?? '' });
  return h('input', { ...common, type: f.type || 'text', value: value ?? '', min: f.type === 'number' ? '0' : null });
}

const readField = (f, el) => (f.type === 'checkbox' ? el.checked : f.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value);

function formDialog({ title, fields, submit = 'Guardar', extra = [] }) {
  return openDialog((close) => {
    const els = fields.map((f) => [f, fieldEl(f, f.value)]);
    const form = h('form', { class: 'dlg-body', onSubmit: (e) => {
      e.preventDefault();
      close(Object.fromEntries(els.map(([f, el]) => [f.key, readField(f, el)])));
    } },
      h('h3', {}, title),
      els.map(([f, el]) => h('label', { class: f.type === 'checkbox' ? 'check' : '' }, f.type === 'checkbox' ? [el, f.label] : [f.label, el])),
      h('div', { class: 'row end' },
        extra.map((x) => h('button', { type: 'button', class: 'btn danger left', onClick: () => close({ __action: x.key }) }, x.label)),
        h('button', { type: 'button', class: 'btn', onClick: () => close(null) }, 'Cancelar'),
        h('button', { type: 'submit', class: 'btn primary' }, submit)));
    return form;
  });
}

// ---------- Acciones de UI ----------

const dispatch = (n, p) => store.dispatch(n, p);

async function boardDialog(mode) {
  const b = store.board;
  if (mode === 'new') {
    const v = await formDialog({ title: 'Nuevo tablero', fields: [{ key: 'name', label: 'Nombre', value: '' }], submit: 'Crear' });
    if (v) dispatch('addBoard', { name: v.name });
  } else {
    const v = await formDialog({
      title: 'Tablero',
      fields: [{ key: 'name', label: 'Nombre', value: b.name }],
      extra: Object.keys(store.state.boards).length > 1 ? [{ key: 'delete', label: 'Eliminar tablero' }] : [],
    });
    if (!v) return;
    if (v.__action === 'delete') {
      if (await confirmDialog(`Se eliminará el tablero "${b.name}" con todas sus tarjetas.`)) dispatch('deleteBoard', { id: b.id });
    } else dispatch('renameBoard', { name: v.name });
  }
}

async function columnDialog(col) {
  const fields = [
    { key: 'title', label: 'Título', value: col ? col.title : '' },
    { key: 'done', label: 'Columna final (las tarjetas cuentan como completadas)', type: 'checkbox', value: col ? col.done : false },
    ...host.collect('columnFields').map((f) => ({ ...f, key: 'meta.' + f.key, label: f.label, value: col ? col.meta[f.key] : '' })),
  ];
  const v = await formDialog({ title: col ? 'Editar columna' : 'Nueva columna', fields, submit: col ? 'Guardar' : 'Crear', extra: col ? [{ key: 'delete', label: 'Eliminar columna' }] : [] });
  if (!v) return;
  if (v.__action === 'delete') {
    const n = col.cards.length;
    if (await confirmDialog(`Se eliminará la columna "${col.title}"${n ? ` y sus ${n} tarjetas` : ''}.`)) dispatch('deleteColumn', { id: col.id });
    return;
  }
  const meta = {};
  for (const [k, val] of Object.entries(v)) if (k.startsWith('meta.')) meta[k.slice(5)] = val;
  if (col) dispatch('updateColumn', { id: col.id, patch: { title: v.title, done: v.done, meta } });
  else dispatch('addColumn', { title: v.title, done: v.done, meta });
}

async function labelsDialog() {
  return openDialog((close) => {
    const board = store.board;
    const name = h('input', { type: 'text', placeholder: 'Nueva etiqueta' });
    const color = h('select', {}, LABEL_COLORS.map((c) => h('option', { value: c }, COLOR_LABEL[c])));
    return h('div', { class: 'dlg-body' },
      h('h3', {}, 'Etiquetas'),
      h('ul', { class: 'plain' }, board.labels.length ? board.labels.map((l) =>
        h('li', {}, h('span', { class: `chip ${l.color}` }, l.name),
          h('button', { class: 'btn small', onClick: () => { dispatch('deleteLabel', { id: l.id }); close(null); labelsDialog(); } }, 'Eliminar')))
        : h('li', { class: 'muted' }, 'No hay etiquetas.')),
      h('div', { class: 'row' }, name, color,
        h('button', { class: 'btn primary', onClick: () => {
          if (!name.value.trim()) return;
          dispatch('addLabel', { name: name.value, color: color.value });
          close(null);
          labelsDialog();
        } }, 'Añadir')),
      h('div', { class: 'row end' }, h('button', { class: 'btn', onClick: () => close(null) }, 'Cerrar')));
  });
}

function cardDialog(cardId) {
  const board = store.board;
  const hit = findCard(board, cardId);
  if (!hit) return;
  const { card, col } = hit;
  return openDialog((close) => {
    const title = h('input', { type: 'text', value: card.title, autofocus: true });
    const desc = h('textarea', { rows: 5, value: card.desc });
    const prio = h('select', {}, PRIORITIES.map((p) => h('option', { value: p, selected: p === card.priority }, PRIORITY_LABEL[p])));
    const assignee = h('input', { type: 'text', value: card.assignee });
    const due = h('input', { type: 'date', value: card.due });
    const colSel = h('select', {}, board.columns.map((c) => h('option', { value: c.id, selected: c.id === col.id }, c.title)));
    const labelSet = new Set(card.labels);
    const labelBox = h('div', { class: 'chips' });
    const drawLabels = () => labelBox.replaceChildren(...board.labels.map((l) =>
      h('button', { type: 'button', class: `chip ${l.color}${labelSet.has(l.id) ? ' on' : ''}`, 'aria-pressed': String(labelSet.has(l.id)), onClick: () => {
        labelSet.has(l.id) ? labelSet.delete(l.id) : labelSet.add(l.id);
        drawLabels();
      } }, l.name)));
    drawLabels();
    if (!board.labels.length) labelBox.append(h('span', { class: 'muted' }, 'Crea etiquetas desde el menú Etiquetas.'));

    const items = card.checklist.map((i) => ({ ...i }));
    const listBox = h('div', { class: 'checklist' });
    const drawList = () => listBox.replaceChildren(...items.map((it, idx) =>
      h('div', { class: 'row' },
        h('input', { type: 'checkbox', checked: it.done, onChange: (e) => { it.done = e.target.checked; } }),
        h('input', { type: 'text', value: it.text, onInput: (e) => { it.text = e.target.value; } }),
        h('button', { type: 'button', class: 'btn small', 'aria-label': 'Quitar elemento', onClick: () => { items.splice(idx, 1); drawList(); } }, 'Quitar'))));
    drawList();
    const newItem = h('input', { type: 'text', placeholder: 'Nuevo elemento (Enter para añadir)' });
    newItem.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (newItem.value.trim()) {
        items.push({ id: null, text: newItem.value.trim(), done: false });
        newItem.value = '';
        drawList();
      }
    });

    const extraFields = host.collect('cardFields').map((f) => [f, fieldEl(f, card.meta[f.key])]);

    const save = () => {
      const meta = {};
      for (const [f, el] of extraFields) meta[f.key] = readField(f, el);
      dispatch('updateCard', { id: card.id, patch: {
        title: title.value, desc: desc.value, priority: prio.value, assignee: assignee.value.trim(), due: due.value,
        labels: [...labelSet], checklist: items.filter((i) => i.text.trim()), meta,
      } });
      if (colSel.value !== col.id) dispatch('moveCard', { id: card.id, to: colSel.value, before: null });
      close(true);
    };

    const form = h('form', { class: 'dlg-body wide', onSubmit: (e) => { e.preventDefault(); save(); } },
      h('h3', {}, 'Tarjeta'),
      h('label', {}, 'Título', title),
      h('label', {}, 'Descripción', desc),
      h('div', { class: 'grid2' },
        h('label', {}, 'Columna', colSel),
        h('label', {}, 'Prioridad', prio),
        h('label', {}, 'Responsable', assignee),
        h('label', {}, 'Fecha límite', due)),
      extraFields.length ? h('div', { class: 'grid2' }, extraFields.map(([f, el]) => h('label', {}, f.label, el))) : null,
      h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Etiquetas'), labelBox),
      h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Checklist'), listBox, newItem),
      h('div', { class: 'row end' },
        h('button', { type: 'button', class: 'btn danger left', onClick: async () => {
          if (await confirmDialog(`Eliminar la tarjeta "${card.title}"?`)) {
            close(null);
            dispatch('deleteCard', { id: card.id });
          }
        } }, 'Eliminar'),
        h('button', { type: 'button', class: 'btn', onClick: () => close(null) }, 'Cancelar'),
        h('button', { type: 'submit', class: 'btn primary' }, 'Guardar')));
    return form;
  });
}

// ---------- Filtros ----------

function visible(card, col) {
  if (ui.q) {
    const q = ui.q.toLowerCase();
    if (![card.title, card.desc, card.assignee].some((s) => s.toLowerCase().includes(q))) return false;
  }
  if (ui.priority && card.priority !== ui.priority) return false;
  if (ui.label && !card.labels.includes(ui.label)) return false;
  if (ui.overdue && !(card.due && card.due < today() && !col.done)) return false;
  return true;
}

// ---------- Render ----------

const root = document.getElementById('app');
const boardScroll = { left: 0 };
const colScroll = new Map();

function chip(text, tone, title) {
  return h('span', { class: `badge ${tone || 'gray'}`, title }, text);
}

function cardEl(card, col, board) {
  const overdue = card.due && card.due < today() && !col.done;
  const done = card.checklist.filter((i) => i.done).length;
  const badges = host.badges('cardBadges', card, col, board);
  const el = h('div', {
    class: `card p-${card.priority}${col.done ? ' done' : ''}`,
    draggable: 'true',
    tabindex: '0',
    role: 'button',
    'aria-label': `Tarjeta ${card.title}`,
    dataset: { id: card.id },
    onClick: () => cardDialog(card.id),
    onKeydown: (e) => {
      if (e.key === 'Enter') cardDialog(card.id);
    },
    onDragstart: (e) => {
      ui.drag = { type: 'card', id: card.id };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.id);
      setTimeout(() => el.classList.add('dragging'), 0);
    },
    onDragend: () => {
      ui.drag = null;
      clearDrop();
      el.classList.remove('dragging');
    },
  },
    card.labels.length ? h('div', { class: 'chips' }, card.labels.map((id) => {
      const l = board.labels.find((x) => x.id === id);
      return l ? h('span', { class: `chip ${l.color}` }, l.name) : null;
    })) : null,
    h('div', { class: 'title' }, card.title),
    h('div', { class: 'meta' },
      card.priority !== 'none' ? chip(PRIORITY_LABEL[card.priority], card.priority === 'urgent' ? 'red' : card.priority === 'high' ? 'black' : 'gray') : null,
      card.due ? chip(fmtDate(card.due), overdue ? 'red' : 'gray', overdue ? 'Vencida' : 'Fecha límite') : null,
      card.checklist.length ? chip(`${done}/${card.checklist.length}`, done === card.checklist.length ? 'black' : 'gray', 'Checklist') : null,
      badges.map((b) => chip(b.text, b.tone, b.title)),
      card.assignee ? h('span', { class: 'avatar', title: card.assignee }, initials(card.assignee)) : null));
  return el;
}

let placeholder = null;
function clearDrop() {
  if (placeholder) placeholder.remove();
  placeholder = null;
  document.querySelectorAll('.drop-col,.drop-before,.drop-after').forEach((n) => n.classList.remove('drop-col', 'drop-before', 'drop-after'));
}

function columnEl(col, board) {
  const cards = col.cards.map((id) => board.cards[id]).filter(Boolean);
  const shown = cards.filter((c) => visible(c, col));
  const filtering = shown.length !== cards.length;
  const body = h('div', { class: 'col-body', dataset: { col: col.id } },
    shown.map((c) => cardEl(c, col, board)));
  if (colScroll.has(col.id)) requestAnimationFrame(() => (body.scrollTop = colScroll.get(col.id)));
  body.addEventListener('scroll', () => colScroll.set(col.id, body.scrollTop));

  body.addEventListener('dragover', (e) => {
    if (!ui.drag || ui.drag.type !== 'card') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearDrop();
    body.classList.add('drop-col');
    const others = [...body.querySelectorAll('.card:not(.dragging)')];
    const next = others.find((c) => e.clientY < c.getBoundingClientRect().top + c.offsetHeight / 2);
    placeholder = h('div', { class: 'placeholder' });
    if (next) body.insertBefore(placeholder, next);
    else body.append(placeholder);
  });
  body.addEventListener('dragleave', (e) => {
    if (!body.contains(e.relatedTarget)) clearDrop();
  });
  body.addEventListener('drop', (e) => {
    if (!ui.drag || ui.drag.type !== 'card') return;
    e.preventDefault();
    const nextEl = placeholder && placeholder.nextElementSibling;
    const before = nextEl && nextEl.dataset.id ? nextEl.dataset.id : null;
    const id = ui.drag.id;
    ui.drag = null;
    clearDrop();
    dispatch('moveCard', { id, to: col.id, before });
  });

  const composer = ui.composer === col.id
    ? h('form', { class: 'composer', onSubmit: (e) => e.preventDefault() },
      (() => {
        const ta = h('textarea', { rows: 2, placeholder: 'Título de la tarjeta (Enter para añadir, Esc para cerrar)', autofocus: true });
        ta.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            ui.composer = null;
            render();
          } else if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const t = ta.value.trim();
            if (!t) return;
            const r = dispatch('addCard', { col: col.id, card: { title: t } });
            if (!r.ok) ta.focus();
          }
        });
        requestAnimationFrame(() => ta.focus());
        return ta;
      })())
    : h('button', { class: 'add-card', onClick: () => { ui.composer = col.id; render(); } }, '+ Añadir tarjeta');

  const colBadges = host.badges('columnBadges', col, board);
  const header = h('div', { class: 'col-head', draggable: 'true' },
    h('h2', {}, col.title, col.done ? h('span', { class: 'done-flag', title: 'Columna final' }, 'final') : null),
    h('span', { class: 'count' }, filtering ? `${shown.length}/${cards.length}` : String(cards.length)),
    colBadges.map((b) => chip(b.text, b.tone, b.title)),
    h('button', { class: 'icon-btn', title: 'Editar columna', 'aria-label': `Editar columna ${col.title}`, onClick: () => columnDialog(col) }, 'Editar'));
  header.addEventListener('dragstart', (e) => {
    ui.drag = { type: 'col', id: col.id };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', col.id);
  });
  header.addEventListener('dragend', () => {
    ui.drag = null;
    clearDrop();
  });

  const el = h('section', { class: 'col', dataset: { id: col.id } }, header, body, composer);
  el.addEventListener('dragover', (e) => {
    if (!ui.drag || ui.drag.type !== 'col' || ui.drag.id === col.id) return;
    e.preventDefault();
    clearDrop();
    const r = el.getBoundingClientRect();
    el.classList.add(e.clientX < r.left + r.width / 2 ? 'drop-before' : 'drop-after');
  });
  el.addEventListener('drop', (e) => {
    if (!ui.drag || ui.drag.type !== 'col') return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const beforeHalf = e.clientX < r.left + r.width / 2;
    const idx = board.columns.findIndex((c) => c.id === col.id);
    const beforeCol = beforeHalf ? col.id : (board.columns[idx + 1] || {}).id || null;
    const id = ui.drag.id;
    ui.drag = null;
    clearDrop();
    if (beforeCol !== id) dispatch('moveColumn', { id, before: beforeCol });
  });
  return el;
}

function drawerEl() {
  const panels = [...host.collect('panels'), { id: 'plugins', title: 'Plugins', render: renderPluginsPanel }];
  const cur = panels.find((p) => p.id === ui.panel);
  if (!cur) return null;
  const body = h('div', { class: 'drawer-body' });
  cur.render(body, api);
  return h('aside', { class: 'drawer', 'aria-label': cur.title },
    h('div', { class: 'tabs', role: 'tablist' }, panels.map((p) =>
      h('button', { role: 'tab', class: 'tab' + (p.id === cur.id ? ' on' : ''), 'aria-selected': String(p.id === cur.id), onClick: () => { ui.panel = p.id; render(); } }, p.title)),
      h('button', { class: 'icon-btn close', 'aria-label': 'Cerrar panel', onClick: () => { ui.panel = null; render(); } }, 'Cerrar')),
    body);
}

function renderPluginsPanel(el) {
  el.append(
    h('p', { class: 'hint' }, 'Activa o desactiva extensiones. Los plugins propios se registran con window.kanban.host.register(plugin).'),
    h('ul', { class: 'plain' }, host.list().map((p) =>
      h('li', { class: 'plugin' },
        h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: host.isEnabled(p.id), onChange: (e) => { host.setEnabled(p.id, e.target.checked); render(); } }),
          h('span', {}, h('strong', {}, p.name), h('br'), h('span', { class: 'muted' }, p.description || ''))))),
    ));
}

function render() {
  const active = document.activeElement;
  const keepFocus = active && active.dataset && active.dataset.keep ? active.dataset.keep : null;
  const prevBoard = root.querySelector('.board');
  if (prevBoard) boardScroll.left = prevBoard.scrollLeft;
  const board = store.board;
  const state = store.state;

  const search = h('input', { type: 'search', placeholder: 'Buscar...', value: ui.q, 'aria-label': 'Buscar tarjetas', dataset: { keep: 'q' } });
  search.addEventListener('input', () => {
    ui.q = search.value;
    const pos = search.selectionStart;
    render();
    const n = root.querySelector('[data-keep="q"]');
    n.focus();
    n.setSelectionRange(pos, pos);
  });

  const toolbarBtns = host.collect('toolbar');
  const header = h('header', { class: 'top' },
    h('div', { class: 'brand' }, 'Kanban'),
    h('select', { class: 'board-sel', 'aria-label': 'Tablero', onChange: (e) => dispatch('selectBoard', { id: e.target.value }) },
      Object.values(state.boards).map((b) => h('option', { value: b.id, selected: b.id === board.id }, b.name))),
    h('button', { class: 'btn', onClick: () => boardDialog('edit') }, 'Tablero'),
    h('button', { class: 'btn', onClick: () => boardDialog('new') }, 'Nuevo tablero'),
    h('button', { class: 'btn', onClick: labelsDialog }, 'Etiquetas'),
    h('span', { class: 'spacer' }),
    search,
    h('select', { 'aria-label': 'Filtrar por prioridad', onChange: (e) => { ui.priority = e.target.value; render(); } },
      h('option', { value: '' }, 'Toda prioridad'), PRIORITIES.filter((p) => p !== 'none').map((p) => h('option', { value: p, selected: ui.priority === p }, PRIORITY_LABEL[p]))),
    h('select', { 'aria-label': 'Filtrar por etiqueta', onChange: (e) => { ui.label = e.target.value; render(); } },
      h('option', { value: '' }, 'Toda etiqueta'), board.labels.map((l) => h('option', { value: l.id, selected: ui.label === l.id }, l.name))),
    h('label', { class: 'check inline' }, h('input', { type: 'checkbox', checked: ui.overdue, onChange: (e) => { ui.overdue = e.target.checked; render(); } }), 'Vencidas'),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn', disabled: !store.canUndo, title: 'Deshacer (Ctrl+Z)', onClick: () => store.undo() }, 'Deshacer'),
    h('button', { class: 'btn', disabled: !store.canRedo, title: 'Rehacer (Ctrl+Shift+Z)', onClick: () => store.redo() }, 'Rehacer'),
    toolbarBtns.map((b) => h('button', { class: 'btn', title: b.title, onClick: () => b.onClick(api) }, b.label)),
    h('button', { class: 'btn primary', onClick: () => { ui.panel = ui.panel ? null : (host.collect('panels')[0] || { id: 'plugins' }).id; render(); } }, 'Paneles'));

  const boardEl = h('main', { class: 'board' },
    board.columns.map((c) => columnEl(c, board)),
    h('button', { class: 'add-col', onClick: () => columnDialog(null) }, '+ Añadir columna'));

  root.replaceChildren(header, h('div', { class: 'layout' }, boardEl, drawerEl()), toasts);
  boardEl.scrollLeft = boardScroll.left;
  document.title = `${board.name} - Kanban`;
  if (keepFocus && keepFocus !== 'q') root.querySelector(`[data-keep="${keepFocus}"]`)?.focus();
}

document.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  const typing = ['input', 'textarea', 'select'].includes(tag);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
    e.preventDefault();
    e.shiftKey ? store.redo() : store.undo();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !typing) {
    e.preventDefault();
    store.redo();
  } else if (!typing && !document.querySelector('dialog[open]')) {
    if (e.key === '/') {
      e.preventDefault();
      root.querySelector('[data-keep="q"]')?.focus();
    } else if (e.key === 'n' && store.board.columns.length) {
      e.preventDefault();
      ui.composer = store.board.columns[0].id;
      render();
    }
  }
});

render();
