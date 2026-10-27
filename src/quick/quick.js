const api = window.quickMenu, root = document.getElementById('items');
let current = null, fittedHeight = 0;
async function action(id, value) {
  try { render(await api.action(id, value)); }
  catch { document.getElementById(id)?.setAttribute('title', 'Действие не выполнено. Попробуй ещё раз.'); }
}
function fitSubmenus() {
  const expanded = [...root.children].filter((item) => item.tagName === 'DETAILS' && item.open);
  const fixedHeight = [...root.children].reduce((height, item) => {
    const style = getComputedStyle(item);
    const submenu = item.tagName === 'DETAILS' && item.open ? item.querySelector(':scope > .submenu') : null;
    return height + item.getBoundingClientRect().height - (submenu?.getBoundingClientRect().height || 0) + parseFloat(style.marginTop) + parseFloat(style.marginBottom);
  }, 0);
  const wanted = expanded.map((details) => Math.min(180, details.querySelector(':scope > .submenu').scrollHeight));
  const wantedHeight = wanted.reduce((height, value) => height + value, 0);
  const extra = document.body.getBoundingClientRect().height - root.getBoundingClientRect().height;
  const desired = Math.ceil(extra + fixedHeight + wantedHeight + 2);
  if (desired !== fittedHeight) { fittedHeight = desired; api.fit(desired).catch(() => {}); }
  // Leave one pixel for fractional Windows display-scale rounding.
  const available = Math.max(0, Math.floor(root.clientHeight - fixedHeight - 1));
  expanded.forEach((details, index) => {
    const height = wantedHeight <= available ? wanted[index] : Math.floor(available * wanted[index] / wantedHeight);
    details.querySelector(':scope > .submenu').style.maxHeight = `${height}px`;
  });
}
function render(state) {
  // Preserve expanded favorites and keyboard focus while state changes.
  const expanded = [...root.querySelectorAll('details[open]')].map((e) => e.dataset.label);
  const focused = document.activeElement?.id;
  current = state; root.replaceChildren();
  let transport = null;
  function append(items, parent) {
    for (const item of items) {
      if (item.type === 'separator') { parent.append(document.createElement('hr')); transport = null; continue; }
      if (item.submenu) { const details = document.createElement('details'), summary = document.createElement('summary'), submenu = document.createElement('div'); submenu.className = 'submenu'; details.dataset.label = item.label; details.open = expanded.includes(item.label); summary.textContent = item.label; details.append(summary, submenu); append(item.submenu, submenu); parent.append(details); continue; }
      if (item.type === 'volume') {
        const label = document.createElement('label'); label.className = 'volume'; label.textContent = item.label;
        const output = document.createElement('output'); output.textContent = Math.round(item.value * 100) + '%';
        const input = document.createElement('input'); input.type = 'range'; input.id = item.id; input.min = 0; input.max = 100; input.value = Math.round(item.value * 100); input.disabled = item.enabled === false; input.setAttribute('aria-label', item.label);
        input.oninput = () => { output.textContent = input.value + '%'; };
        input.onchange = () => action(item.id, Number(input.value) / 100); label.append(output, input); parent.append(label); continue;
      }
      const button = document.createElement('button'); button.className = 'action'; button.disabled = item.enabled === false;
      if (item.id) { button.id = item.id; button.onclick = () => action(item.id); }
      button.textContent = item.label;
      if (item.type === 'checkbox') button.setAttribute('aria-pressed', String(Boolean(item.checked)));
      if (['quick-music-prev', 'quick-music-toggle', 'quick-music-next'].includes(item.id)) {
        if (!transport) { transport = document.createElement('div'); transport.className = 'transport'; parent.append(transport); }
        button.title = item.label; button.setAttribute('aria-label', item.label);
        button.textContent = item.id === 'quick-music-prev' ? '⏮' : item.id === 'quick-music-next' ? '⏭' : item.label === 'Пауза' ? 'Ⅱ' : '▶'; transport.append(button);
      } else { transport = null; parent.append(button); }
    }
  }
  append(state.items, root);
  fitSubmenus();
  if (focused) document.getElementById(focused)?.focus({ preventScroll: true });
}
root.addEventListener('toggle', fitSubmenus, true);
window.addEventListener('resize', fitSubmenus);
document.getElementById('close').onclick = () => api.close();
window.addEventListener('mousedown', (e) => { if (e.button === 1) { e.preventDefault(); api.close(); } });
window.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') api.close(); });
api.onState(render); api.state().then(render).catch(() => api.close());
