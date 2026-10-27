const $ = (id) => document.getElementById(id);
const phases = { disconnected: 'Отключён', connecting: 'Подключение…', connected: 'Подключён', reconnecting: 'Восстановление…', error: 'Ошибка' };
const lines = (value) => String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
function bytes(value) { const n = Number(value) || 0; if (n < 1024) return Math.round(n) + ' Б'; if (n < 1048576) return (n / 1024).toFixed(1) + ' КБ'; return (n / 1048576).toFixed(1) + ' МБ'; }
export function createVpnUI(api) {
  let state = null, busy = false, serverKey = '', profileKey = '', formsFilled = false, favoritesOnly = false;
  const error = (message = '') => { $('vpn-error').textContent = message; $('vpn-error').hidden = !message; };
  function fillSettings(settings) {
    const tun = settings.tun, dns = settings.dns;
    $('vpn-tun').checked = tun.enable; $('vpn-mode').value = settings.mode; $('vpn-port').value = settings.proxyPort; $('vpn-ipv6').checked = settings.ipv6;
    for (const key of ['stack', 'device', 'mtu']) $('tun-' + key).value = tun[key];
    for (const key of ['auto-route', 'strict-route', 'auto-detect-interface']) $('tun-' + key).checked = tun[key];
    for (const key of ['dns-hijack', 'inet4-address', 'inet6-address', 'route-address', 'route-exclude-address', 'exclude-interface']) $('tun-' + key).value = (tun[key] || []).join('\n');
    $('dns-mode').value = dns['enhanced-mode']; $('dns-ipv6').checked = dns.ipv6;
    for (const key of ['nameserver', 'default-nameserver', 'proxy-server-nameserver']) $('dns-' + key).value = (dns[key] || []).join('\n');
    $('vpn-rules').value = (settings.rules || []).join('\n'); $('vpn-bypass-sites').value = (settings.bypassSites || []).join('\n'); formsFilled = true;
  }
  function render(next) {
    const portChanged = state && state.settings.proxyPort !== next.settings.proxyPort;
    state = next;
    $('vpn-phase').textContent = phases[state.phase] || state.phase;
    $('vpn-phase').dataset.phase = state.phase;
    $('vpn-connect').textContent = ['connected', 'connecting', 'reconnecting'].includes(state.phase) ? 'Отключить' : 'Подключить';
    $('vpn-connect').disabled = busy;
    $('vpn-runtime').textContent = state.settings.tun.enable ? 'Системный TUN · Mihomo ' + state.version : 'Локальный прокси · Mihomo ' + state.version;
    $('vpn-address').textContent = state.proxyAddress || '127.0.0.1:' + state.settings.proxyPort;
    $('vpn-down').textContent = bytes(state.traffic.down) + '/с'; $('vpn-up').textContent = bytes(state.traffic.up) + '/с';
    $('vpn-total-down').textContent = bytes(state.traffic.downloadTotal); $('vpn-total-up').textContent = bytes(state.traffic.uploadTotal);
    const key = JSON.stringify([state.profiles, state.activeId]);
    if (profileKey !== key) {
      profileKey = key; $('vpn-profile').replaceChildren();
      if (!state.profiles.length) { const option = document.createElement('option'); option.textContent = 'Импортируй профиль'; option.value = ''; $('vpn-profile').append(option); }
      for (const profile of state.profiles) { const option = document.createElement('option'); option.value = profile.id; option.textContent = profile.name + (profile.subscription ? ' · подписка' : ''); option.selected = profile.id === state.activeId; $('vpn-profile').append(option); }
    }
    const active = state.profiles.find((profile) => profile.id === state.activeId);
    $('vpn-update-subscription').disabled = busy || !active?.subscription; $('vpn-rollback').disabled = busy || !active?.canRollback; $('vpn-remove-profile').disabled = busy || !active;
    $('vpn-service-state').textContent = state.service.running ? 'Служба работает' : state.service.installed ? 'Служба установлена' : 'Для системного TUN установи службу';
    $('vpn-logs').textContent = state.logs.map((entry) => `${new Date(entry.at).toLocaleTimeString('ru-RU')}  ${entry.level.toUpperCase()}  ${entry.message}`).join('\n') || 'Ошибок пока нет.';
    const proxiesKey = JSON.stringify([state.proxies, state.favorites, state.activeId]);
    if (serverKey !== proxiesKey) { serverKey = proxiesKey; renderServers(state.proxies); }
    if (!formsFilled) fillSettings(state.settings);
    else if (portChanged) $('vpn-port').value = state.settings.proxyPort;
    if (state.error) error(state.error);
  }
  async function run(action, refill = false) {
    if (busy) return;
    busy = true; $('vpn-connect').disabled = true; $('vpn').setAttribute('aria-busy', 'true'); error('');
    try {
      const result = await action();
      if (!result.ok) throw new Error(result.error || 'Операция VPN не выполнена.');
      if (refill) formsFilled = false;
      if (result.state) render(result.state);
      return result;
    } catch (err) { error(err.message); if (refill && state) fillSettings(state.settings); }
    finally { busy = false; $('vpn').removeAttribute('aria-busy'); if (state) render(state); $('vpn-connect').disabled = false; }
  }
  function renderServers(proxies) {
    const container = $('vpn-servers'); container.replaceChildren();
    const groups = proxies.filter((proxy) => proxy.type === 'Selector' && proxy.all);
    if (!proxies.length) { const hint = document.createElement('p'); hint.className = 'muted'; hint.textContent = 'Подключи профиль, чтобы увидеть серверы и группы.'; container.append(hint); return; }
    const favorites = new Set(state.favorites || []), byName = new Map(proxies.map((p) => [p.name, p]));
    const toolbar = document.createElement('div'); toolbar.className = 'vpn-server-toolbar';
    const filter = document.createElement('button'); filter.type = 'button'; filter.className = 'vpn-favorites-filter'; filter.textContent = '★ Избранные'; filter.setAttribute('aria-pressed', String(favoritesOnly));
    filter.onclick = () => { favoritesOnly = !favoritesOnly; renderServers(state.proxies); };
    toolbar.append(filter); container.append(toolbar);
    for (const group of groups) {
      const row = document.createElement('div'); row.className = 'vpn-group';
      const title = document.createElement('span'); title.textContent = group.name;
      const select = document.createElement('select'); select.setAttribute('aria-label', group.name);
      const saved = document.createElement('optgroup'); saved.label = 'Избранные';
      const others = document.createElement('optgroup'); others.label = favoritesOnly ? 'Текущая локация' : 'Все локации';
      for (const name of group.all) {
        if (favoritesOnly && !favorites.has(name) && name !== group.now) continue;
        const proxy = byName.get(name), option = document.createElement('option');
        option.value = name; option.textContent = name + (proxy ? ' · ' + proxy.type : '') + (proxy?.delay ? ' · ' + proxy.delay + ' мс' : ''); option.selected = name === group.now;
        (favorites.has(name) ? saved : others).append(option);
      }
      if (saved.childElementCount) select.append(saved);
      if (others.childElementCount) select.append(others);
      select.onchange = () => run(() => api.selectProxy(group.name, select.value));
      const star = document.createElement('button'); star.type = 'button'; star.className = 'vpn-favorite';
      const isFavorite = favorites.has(group.now), current = byName.get(group.now);
      star.textContent = isFavorite ? '★' : '☆'; star.setAttribute('aria-pressed', String(isFavorite));
      star.setAttribute('aria-label', (isFavorite ? 'Убрать из избранного: ' : 'Добавить в избранное: ') + group.now);
      star.title = isFavorite ? 'Убрать из избранного' : 'Добавить в избранное';
      star.disabled = !current || Boolean(current.all) || ['Direct', 'Reject', 'Pass', 'Compatible', 'RejectDrop', 'PassRule'].includes(current.type);
      star.onclick = () => run(() => api.setFavorite(group.now, !isFavorite));
      const check = document.createElement('button'); check.textContent = 'Пинг'; check.type = 'button';
      check.onclick = async () => { check.disabled = true; const result = await run(() => api.delay(select.value)); if (result) check.textContent = result.delay ? result.delay + ' мс' : 'Нет ответа'; check.disabled = false; };
      row.append(title, select, star, check); container.append(row);
    }
    if (favoritesOnly && !proxies.some((p) => favorites.has(p.name))) { const hint = document.createElement('p'); hint.className = 'muted'; hint.textContent = 'Выбери локацию и нажми ☆, чтобы добавить её в избранное.'; container.append(hint); }
  }
  $('vpn-connect').onclick = () => run(() => ['connected', 'connecting', 'reconnecting'].includes(state?.phase) ? api.stop() : api.start());
  $('vpn-restart').onclick = () => run(() => api.restart());
  $('vpn-profile').onchange = () => run(() => api.selectProfile($('vpn-profile').value), true);
  $('vpn-import-file').onclick = () => run(() => api.importFile());
  $('vpn-update-subscription').onclick = () => run(() => api.updateSubscription(state.activeId));
  $('vpn-rollback').onclick = () => run(() => api.rollbackProfile(state.activeId));
  $('vpn-remove-profile').onclick = () => run(() => api.removeProfile(state.activeId));
  $('vpn-subscription-form').onsubmit = (event) => {
    event.preventDefault(); const name = $('vpn-subscription-name').value.trim(), url = $('vpn-subscription-url').value.trim();
    $('vpn-subscription-url').value = ''; run(() => api.importSubscription(name, url));
  };
  $('vpn-tun').onchange = () => run(() => api.updateSettings({ tun: { ...state.settings.tun, enable: $('vpn-tun').checked } }), true);
  $('vpn-basic-form').onsubmit = (event) => { event.preventDefault(); run(() => api.updateSettings({ mode: $('vpn-mode').value, proxyPort: Number($('vpn-port').value), ipv6: $('vpn-ipv6').checked }), true); };
  $('vpn-tun-form').onsubmit = (event) => {
    event.preventDefault(); const tun = { ...state.settings.tun, stack: $('tun-stack').value, device: $('tun-device').value, mtu: Number($('tun-mtu').value) };
    for (const key of ['auto-route', 'strict-route', 'auto-detect-interface']) tun[key] = $('tun-' + key).checked;
    for (const key of ['dns-hijack', 'inet4-address', 'inet6-address', 'route-address', 'route-exclude-address', 'exclude-interface']) tun[key] = lines($('tun-' + key).value);
    run(() => api.updateSettings({ tun }), true);
  };
  $('vpn-dns-form').onsubmit = (event) => {
    event.preventDefault(); const dns = { 'enhanced-mode': $('dns-mode').value, ipv6: $('dns-ipv6').checked };
    for (const key of ['nameserver', 'default-nameserver', 'proxy-server-nameserver']) dns[key] = lines($('dns-' + key).value);
    run(() => api.updateSettings({ dns }), true);
  };
  $('vpn-rules-form').onsubmit = (event) => { event.preventDefault(); run(() => api.updateSettings({ rules: lines($('vpn-rules').value) }), true); };
  $('vpn-bypass-form').onsubmit = (event) => { event.preventDefault(); run(() => api.updateSettings({ bypassSites: lines($('vpn-bypass-sites').value) }), true); };
  document.querySelectorAll('[data-vpn-service]').forEach((button) => { button.onclick = () => run(() => api.service(button.dataset.vpnService), true); });
  api.onState(render);
  return { open: () => run(() => api.getStatus()) };
}
