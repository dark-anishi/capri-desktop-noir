'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
function paths(app) {
  const root = path.resolve(__dirname, '../../..');
  const base = app.isPackaged ? process.resourcesPath : root;
  return {
    core: path.join(base, app.isPackaged ? 'vpn/mihomo.exe' : 'vendor/mihomo/mihomo.exe'),
    helper: path.join(base, app.isPackaged ? 'native/Capri.Windows.exe' : 'native/bin/Capri.Windows.exe'),
    manifest: path.join(base, app.isPackaged ? 'native/manifest.json' : 'native/bin/manifest.json'),
    elevatedScript: path.join(base, app.isPackaged ? 'native/service-control.ps1' : 'native/service-control.ps1'),
    installedHelper: path.join(process.env.ProgramW6432 || process.env.ProgramFiles || 'C:/Program Files', 'CapriVPN/Capri.Windows.exe'),
  };
}
function verify(file, hash) {
  if (!/^[a-f0-9]{64}$/.test(hash || '')) throw new Error('Отсутствует контрольная сумма компонента.');
  const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (actual !== hash) throw new Error('Проверка целостности компонента не пройдена. Переустанови Capri.');
}
module.exports = { paths, verify };
