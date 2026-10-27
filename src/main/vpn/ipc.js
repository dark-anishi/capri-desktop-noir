'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { MAX_BYTES } = require('./config');
function string(value, max = 200) { if (typeof value !== 'string' || !value || value.length > max || /[\u0000-\u001f]/.test(value)) throw new Error('Некорректный текстовый аргумент VPN.'); return value; }
function validateAction(action, payload) {
  const actions = ['status', 'start', 'stop', 'restart', 'import-file', 'import-subscription', 'update-subscription', 'select-profile', 'rollback-profile', 'remove-profile', 'settings', 'select-proxy', 'favorite', 'delay', 'service'];
  if (!actions.includes(action)) throw new Error('Неизвестная операция VPN.');
  if (['status', 'start', 'stop', 'restart', 'import-file'].includes(action)) { if (payload !== undefined && payload !== null) throw new Error('Операция не принимает аргументы.'); return {}; }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || JSON.stringify(payload).length > MAX_BYTES) throw new Error('Некорректные аргументы VPN.');
  const fields = { 'import-subscription': ['name', 'url'], 'update-subscription': ['id'], 'select-profile': ['id'], 'rollback-profile': ['id'], 'remove-profile': ['id'], 'select-proxy': ['group', 'name'], favorite: ['name', 'favorite'], delay: ['name'], service: ['operation'] }[action];
  if (fields) {
    if (Object.keys(payload).some((key) => !fields.includes(key)) || fields.some((key) => !(key in payload))) throw new Error('Неверные поля операции VPN.');
    for (const field of fields) if (field === 'favorite') { if (typeof payload.favorite !== 'boolean') throw new Error('Неверный переключатель избранного.'); } else string(payload[field], field === 'url' ? 8192 : 200);
  }
  if (payload.id && !/^[a-f0-9-]{36}$/i.test(payload.id)) throw new Error('Неверный идентификатор профиля.');
  if (action === 'service' && !['install', 'uninstall', 'start', 'stop'].includes(payload.operation)) throw new Error('Недопустимая операция службы.');
  return payload;
}
async function dispatch(manager, action, payload, { dialog, window }) {
  payload = validateAction(action, payload);
  switch (action) {
    case 'status': return { state: manager.state() };
    case 'start': return { state: await manager.start() };
    case 'stop': return { state: await manager.stop() };
    case 'restart': return { state: await manager.restart() };
    case 'import-file': {
      const result = await dialog.showOpenDialog(window, { title: 'Импорт профиля Mihomo', properties: ['openFile'], filters: [{ name: 'Mihomo / Clash YAML', extensions: ['yaml', 'yml', 'json'] }] });
      if (result.canceled) return { state: manager.state() };
      const file = result.filePaths[0]; if (fs.statSync(file).size > MAX_BYTES) throw new Error('Профиль превышает 2 МБ.');
      return { state: await manager.importConfig(path.basename(file, path.extname(file)).slice(0, 80), fs.readFileSync(file, 'utf8')) };
    }
    case 'import-subscription': return { state: await manager.importSubscription(payload.name, payload.url) };
    case 'update-subscription': return { state: await manager.updateSubscription(payload.id) };
    case 'select-profile': return { state: await manager.selectProfile(payload.id) };
    case 'rollback-profile': return { state: await manager.rollbackProfile(payload.id) };
    case 'remove-profile': return { state: await manager.removeProfile(payload.id) };
    case 'settings': return { state: await manager.updateSettings(payload) };
    case 'select-proxy': return { state: await manager.selectProxy(payload.group, payload.name) };
    case 'favorite': return { state: await manager.setFavorite(payload.name, payload.favorite) };
    case 'delay': return await manager.delay(payload.name);
    case 'service': return { state: await manager.serviceControl(payload.operation) };
    default: throw new Error('Недопустимая операция VPN.');
  }
}
module.exports = { validateAction, dispatch };
