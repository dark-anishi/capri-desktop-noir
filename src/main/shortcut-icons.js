'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createWindowsHelper } = require('./windows-helper');

function expandPath(value, base) {
  value = String(value || '').trim().replace(/^"(.*)"$/, '$1')
    .replace(/%([^%]+)%/g, (match, key) => process.env[key] || process.env[Object.keys(process.env).find((k) => k.toLowerCase() === key.toLowerCase())] || match);
  return value ? path.resolve(base, value) : '';
}

function readUrlIcon(file, source = file) {
  const bytes = fs.readFileSync(file);
  const text = bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.subarray(2).toString('utf16le') : bytes.toString('utf8');
  let section = '';
  const values = {};
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const group = line.trim().match(/^\[([^\]]+)\]$/);
    if (group) { section = group[1].toLowerCase(); continue; }
    const pair = line.match(/^\s*([^=]+?)\s*=(.*)$/);
    if (section === 'internetshortcut' && pair) values[pair[1].toLowerCase()] = pair[2].trim();
  }
  return { icon: expandPath(values.iconfile, path.dirname(source)), iconIndex: Number(values.iconindex) || 0 };
}

function createShortcutIcons({ app, shell, nativeImage }) {
  const cache = new Map();
  const windows = createWindowsHelper(app);
  return async function iconFor(file, source = file) {
    const stat = fs.statSync(file);
    let details = {};
    try {
      details = path.extname(file).toLowerCase() === '.url' ? readUrlIcon(file, source) : shell.readShortcutLink(file);
    } catch { /* fall back to the Windows shell */ }
    const iconPath = expandPath(details.icon, path.dirname(source));
    let iconStamp = '';
    try { iconStamp = fs.statSync(iconPath).mtimeMs; } catch { /* missing icon */ }
    const key = `${file}:${stat.mtimeMs}:${iconPath}:${iconStamp}:${details.iconIndex || 0}`;
    if (cache.has(key)) return cache.get(key);
    const work = (async () => {
      if (iconPath && /\.(ico|png|jpe?g|bmp)$/i.test(iconPath)) {
        const custom = nativeImage.createFromPath(iconPath);
        if (!custom.isEmpty()) return custom.resize({ width: 48, height: 48 }).toDataURL();
      }
      if (process.platform === 'win32') {
        // Let Windows decode EXE/DLL/ICL resources, resource IDs, shell links and
        // installed shell icon handlers rather than accepting a generic file icon.
        for (const candidate of [iconPath, details.target, file].filter(Boolean)) {
          try {
            const result = await windows.run(['--icon'], { file: candidate, index: candidate === iconPath ? details.iconIndex || 0 : 0 }, 5000);
            if (result.icon) return result.icon;
          } catch { /* the next Windows source or Electron's shell fallback may work */ }
        }
      }
      // SHGetFileInfo resolves icon resources (including IconIndex) on .lnk files.
      // Explicit ICOs above handle Steam .url files, which otherwise show a browser globe.
      const candidates = details.icon && details.iconIndex ? [file, iconPath, details.target] : [iconPath, details.target, file];
      for (const candidate of candidates.filter(Boolean)) {
        try {
          const image = await app.getFileIcon(candidate, { size: 'large' });
          if (!image.isEmpty()) return image.toDataURL();
        } catch { /* try the next source */ }
      }
      return '';
    })();
    cache.set(key, work);
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    return work;
  };
}
module.exports = { createShortcutIcons, readUrlIcon, expandPath };
