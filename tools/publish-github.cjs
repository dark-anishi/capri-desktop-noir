'use strict';
// Uses Git Credential Manager; never prints or stores its access token.
const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const result = spawnSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', windowsHide: true, env: { ...process.env, GCM_INTERACTIVE: 'never' } });
if (result.status !== 0) throw new Error('GitHub login is required in Git Credential Manager.');
const credential = Object.fromEntries(result.stdout.split(/\r?\n/).filter(line => line.includes('=')).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
if (!credential.password) throw new Error('GitHub credential unavailable.');
const headers = { Authorization: 'Bearer ' + credential.password, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Capri-Desktop-Publisher' };
async function api(endpoint, options = {}) {
  const response = await fetch('https://api.github.com' + endpoint, { ...options, headers: { ...headers, ...(options.body ? { 'Content-Type': 'application/json' } : {}) }, signal: AbortSignal.timeout(45000) });
  const data = await response.json();
  if (!response.ok) { const error = new Error(`GitHub HTTP ${response.status}: ${data.message || 'request failed'}`); error.status = response.status; throw error; }
  return data;
}
(async () => {
  const user = await api('/user');
  if (!/^[a-z0-9-]+$/i.test(user.login)) throw new Error('Unexpected account identity.');
  const name = process.env.CAPRI_GITHUB_REPO || 'capri-desktop-noir', base = '/repos/' + user.login + '/' + name;
  if (!/^[a-z0-9._-]+$/i.test(name)) throw new Error('Invalid repository name.');
  const command = process.argv[2] || 'status';
  if (command === 'status') { console.log(JSON.stringify({ login: user.login, id: user.id, noreply: `${user.id}+${user.login}@users.noreply.github.com` })); return; }
  if (command === 'verify') {
    const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
    const repo = await api(base), commit = await api(base + '/commits/main');
    const release = await api(base + '/releases/tags/v' + version);
    const screenshots = await api(base + '/contents/docs/screenshots/' + version);
    const expected = ['apps.png', 'apps-context.png', 'folders.png', 'music.png', 'skins.png', 'vpn.png', 'quick-menu.png'];
    if (!repo.private || expected.some(name => !screenshots.some(file => file.name === name))) throw new Error('Repository or screenshot verification failed.');
    const animations = await api(base + '/contents/docs/animations/' + version);
    const expectedAnimations = ['seated.gif', 'music.gif', 'sleep.gif', 'gaze.gif', 'thinking.gif', 'wave.gif'];
    if (expectedAnimations.some(name => !animations.some(file => file.name === name))) throw new Error('Animation verification failed.');
    for (const name of [`Capri-Setup-${version}.exe`, 'SHA256SUMS.txt']) {
      const asset = release.assets.find(item => item.name === name);
      if (!asset || asset.size !== fs.statSync(path.join(root, 'dist', name)).size) throw new Error('Release asset missing or incomplete: ' + name);
    }
    console.log(JSON.stringify({ repository: repo.html_url, private: repo.private, commit: commit.sha, release: release.html_url, screenshots: expected.length, animations: expectedAnimations.length, assets: release.assets.map(asset => ({ name: asset.name, size: asset.size, digest: asset.digest })) }));
    return;
  }
  if (command === 'create') {
    let repo;
    try { repo = await api(base); }
    catch (error) { if (error.status !== 404) throw error; repo = await api('/user/repos', { method: 'POST', body: JSON.stringify({ name, private: true, description: 'Capri Desktop NOIR — Electron desktop companion, app launcher, music, Mihomo VPN and Zapret controls.', auto_init: false, has_issues: true, has_wiki: false }) }); }
    if (!repo.private || repo.size !== 0) throw new Error('Existing repository is public or contains data; refusing to overwrite it.');
    console.log(JSON.stringify({ url: repo.html_url, clone: repo.clone_url, private: repo.private })); return;
  }
  if (command === 'release') {
    const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version, tag = 'v' + version;
    const notes = fs.readFileSync(path.join(root, `docs/RELEASE-${version}.md`), 'utf8');
    let release;
    try { release = await api(base + '/releases/tags/' + tag); }
    catch (error) { if (error.status !== 404) throw error; release = await api(base + '/releases', { method: 'POST', body: JSON.stringify({ tag_name: tag, target_commitish: 'main', name: 'Capri Desktop NOIR ' + version, body: notes, draft: false, prerelease: false }) }); }
    const upload = release.upload_url.replace(/\{.*$/, '');
    if (!upload.startsWith('https://uploads.github.com/repos/' + user.login + '/' + name + '/')) throw new Error('Unexpected release upload host.');
    for (const file of [`Capri-Setup-${version}.exe`, 'SHA256SUMS.txt']) {
      if (release.assets.some(asset => asset.name === file)) continue;
      const absolute = path.join(root, 'dist', file), size = fs.statSync(absolute).size;
      console.log('Uploading ' + file);
      const response = await fetch(upload + '?name=' + encodeURIComponent(file), { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': String(size) }, body: fs.createReadStream(absolute), duplex: 'half', signal: AbortSignal.timeout(300000) });
      const data = await response.json(); if (!response.ok) throw new Error('Release upload failed: ' + response.status + ' ' + (data.message || ''));
      console.log(JSON.stringify({ asset: data.name, size: data.size }));
    }
    console.log(JSON.stringify({ release: release.html_url })); return;
  }
  throw new Error('Unknown publisher action.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
