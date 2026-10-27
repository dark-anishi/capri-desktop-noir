'use strict';
const { execFile } = require('node:child_process');
function serviceError(code) {
  const messages = {
    5: 'Windows запретила доступ к службе Capri VPN. Подтверди права администратора.',
    1053: 'Служба Capri VPN не ответила Windows вовремя. Нажми «Установить / обновить службу», чтобы заменить старый компонент.',
    1058: 'Служба Capri VPN отключена в Windows. Установи / обнови службу.',
    1060: 'Служба Capri VPN не установлена. Сначала нажми «Установить / обновить службу».',
    1067: 'Служба Capri VPN аварийно завершилась. Установи / обнови службу и повтори запуск.',
    1072: 'Windows ещё удаляет старую службу Capri VPN. Перезагрузи компьютер и установи службу снова.',
    1223: 'Запрос прав администратора UAC был отменён. Для установки и запуска службы нужно подтвердить запрос Windows.',
    1460: 'Истекло время ожидания службы Capri VPN. Установи / обнови службу и повтори запуск.',
  };
  return new Error(messages[code] || `Операция службы Capri VPN завершилась с кодом ${Number.isInteger(code) ? code : 'неизвестно'}. Установи / обнови службу и повтори попытку.`);
}
function controlService(binaries, operation, sid, execute = execFile) {
  if (!['install', 'uninstall', 'start', 'stop'].includes(operation) || !/^S-1-5-21-[0-9-]+$/.test(sid)) return Promise.reject(new Error('Некорректная операция службы.'));
  return new Promise((resolve, reject) => execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', binaries.elevatedScript, '-Operation', operation, '-Helper', binaries.helper, '-Core', binaries.core, '-Owner', sid], { windowsHide: true, timeout: 120000, encoding: 'utf8', maxBuffer: 16384 }, (err, stdout) => {
    let result; try { result = JSON.parse(String(stdout || '').replace(/^\uFEFF/, '').trim()); } catch { }
    if (!err && result?.ok === true && result.code === 0) return resolve();
    reject(serviceError(Number.isInteger(result?.code) ? result.code : err?.killed ? 1460 : Number.isInteger(err?.code) ? err.code : 1));
  }));
}
module.exports = { controlService, serviceError };
