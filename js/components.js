import { esc } from './ui.js';

export function statCard(label, value, sub = '', { id, cls = '' } = {}) {
  return `<div class="stat ${cls}"${id ? ` data-stat="${id}"` : ''}>
    <div class="stat-label">${esc(label)}</div>
    <div class="stat-value">${value}</div>
    ${sub ? `<div class="stat-sub">${sub}</div>` : ''}
  </div>`;
}

/** items: [{ cls, label, kind: 'dot'|'line'|'bar'|'ref' }] */
export function legend(items) {
  return `<ul class="legend">${items.map(i => `<li><span class="key ${i.kind || 'bar'} ${i.cls || ''}" aria-hidden="true"></span>${esc(i.label)}</li>`).join('')}</ul>`;
}

export function tip(title, rows) {
  return `<div class="tip-title">${esc(title)}</div>${rows.map(([k, v]) => `<div class="tip-row"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('')}`;
}
