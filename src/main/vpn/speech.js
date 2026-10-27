'use strict';
function createVpnNarrator(speak) {
  let previous = null;
  return (state) => {
    const proxies = state.proxies || [];
    let groups = proxies.filter((p) => p.type === 'Selector' && p.name !== 'GLOBAL');
    if (state.settings?.mode === 'global') {
      const byName = new Map(proxies.map((p) => [p.name, p])), seen = new Set(); groups = [];
      for (let proxy = byName.get('GLOBAL'); proxy && !seen.has(proxy.name); proxy = byName.get(proxy.now)) {
        seen.add(proxy.name); if (proxy.type === 'Selector') groups.push(proxy);
      }
    }
    const selections = Object.fromEntries(groups.map((p) => [p.name, p.now]));
    const old = previous; previous = { phase: state.phase, activeId: state.activeId, selections };
    if (old?.phase !== state.phase) {
      if (state.phase === 'connecting' && old?.phase !== 'reconnecting') speak('vpnConnecting');
      else if (state.phase === 'connected') speak('vpnConnected');
      else if (state.phase === 'reconnecting') speak('vpnReconnecting');
      else if (state.phase === 'error') speak('vpnError');
      else if (state.phase === 'disconnected' && old && old.phase !== 'disconnected') speak('vpnDisconnected');
      return;
    }
    if (state.phase !== 'connected' || old.activeId !== state.activeId) return;
    const changed = Object.entries(selections).find(([group, selected]) => selected && old.selections[group] !== undefined && old.selections[group] !== selected);
    if (changed) speak('vpnLocation', { location: String(changed[1]).replace(/https?:\/\/\S+/gi, '[ссылка]').slice(0, 100) });
  };
}
module.exports = { createVpnNarrator };
