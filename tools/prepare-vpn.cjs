'use strict';
const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../vendor/mihomo');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
(async () => {
  for (const [name, entry] of Object.entries(manifest.assets)) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) {
      const response = await fetch(entry.url, { signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw new Error('Official Mihomo download failed: ' + name);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (crypto.createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error('SHA256 mismatch: ' + name);
      fs.writeFileSync(file, bytes);
    }
    if (hash(file) !== entry.sha256) throw new Error('Untrusted vendor asset: ' + name);
  }
  const executable = path.join(root, 'mihomo.exe');
  if (!fs.existsSync(executable)) {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'unpack-core.ps1'), '-Archive', path.join(root, 'core.zip'), '-Output', executable], { windowsHide: true });
  }
  if (hash(executable) !== manifest.executable.sha256) throw new Error('Untrusted Mihomo executable');
  console.log('Pinned Mihomo executable, source and dependency archives verified.');
})().catch((err) => { console.error(err.message); process.exitCode = 1; });
