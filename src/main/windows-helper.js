'use strict';
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { paths, verify } = require('./vpn/paths');
function createWindowsHelper(app) {
  let active = 0; const queue = []; let checked = false;
  function run(args, input, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const launch = () => {
        active++;
        try {
          const p = paths(app);
          if (!checked) { verify(p.helper, JSON.parse(fs.readFileSync(p.manifest, 'utf8')).helperSha256); checked = true; }
          const child = execFile(p.helper, args, { windowsHide: true, timeout, maxBuffer: 5 * 1024 * 1024, encoding: 'utf8' }, (err, stdout) => {
            active--; queue.shift()?.();
            let result; try { result = JSON.parse(stdout.trim()); } catch { reject(new Error(err ? 'Windows-компонент недоступен или служба не установлена.' : 'Некорректный ответ Windows-компонента.')); return; }
            if (err || result.ok === false) reject(new Error(result.error || 'Операция Windows не выполнена.'));
            else resolve(result);
          });
          child.stdin.on('error', () => {});
          child.stdin.end(input === undefined ? '' : JSON.stringify(input));
        } catch (err) { active--; queue.shift()?.(); reject(err); }
      };
      if (active < 4) launch(); else queue.push(launch);
    });
  }
  return { run };
}
module.exports = { createWindowsHelper };
