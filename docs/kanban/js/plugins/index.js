// Lista de plugins incluidos. Para añadir uno propio: crear el módulo y registrarlo aquí
// (o llamar a window.kanban.host.register(plugin) desde la consola / otro script).

import wip from './wip.js';
import automations from './automations.js';
import metrics from './metrics.js';
import activity from './activity.js';
import io from './io.js';

export default [metrics, automations, activity, wip, io];
