'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawn } = require('node:child_process');
const { _electron } = require(process.env.CAPRI_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-question-ui-')); let app;
  const port = '47829', errors = [];
  fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ welcomed: true, linked: true, muted: true, wander: false, possess: false, skin: 'mono', lang: 'ru' }));
  try {
    app = await _electron.launch({ executablePath: process.env.CAPRI_TEST_APP || require('electron'), args: process.env.CAPRI_TEST_APP ? ['--dev'] : [root, '--dev'], cwd: root, env: { ...process.env, CAPRI_TEST_DATA: temp, CAPRI_PORT: port } });
    const page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message));
    await page.waitForFunction(() => document.querySelector('#sprite')?.dataset.busy === 'false', null, { timeout: 45000 });
    await page.waitForTimeout(1500);
    await page.waitForFunction(() => /Капри в сети|Снова на твоём рабочем столе/.test(document.querySelector('.panel__line').textContent), null, { timeout: 45000 });
    async function hook(event) {
      const hookFile = process.env.CAPRI_TEST_APP ? path.join(path.dirname(process.env.CAPRI_TEST_APP), 'resources/app.asar.unpacked/hooks/capri-hook.js') : path.join(root, 'hooks/capri-hook.js');
      const p = spawn(process.execPath, [hookFile], { windowsHide: true, env: { ...process.env, CAPRI_PORT: port } });
      const ended = new Promise((resolve, reject) => { p.on('error', reject); p.on('close', resolve); });
      p.stdin.end(JSON.stringify({ session_id: 'question-ui', ...event })); assert.equal(await ended, 0);
    }
    const question = { tool_name: 'request_user_input_async', tool_use_id: 'ui-question', tool_input: { questions: [{ title: 'Куда положить папку?', options: ['Работа', 'Игры'] }] } };
    await hook({ ...question, hook_event_name: 'PreToolUse' });
    await page.locator('.panel__quote').filter({ hasText: 'Куда положить папку?' }).waitFor({ state: 'attached' });
    try { await page.locator('.panel__quote').waitFor({ state: 'visible', timeout: 15000 }); }
    catch (e) { console.log(await page.evaluate(() => ({ panel: document.querySelector('#panel').outerHTML.slice(0, 1500), pose: document.querySelector('#sprite').dataset, errors: [] }))); throw e; }
    await page.waitForFunction(() => /вопрос|ответ|уточнить/.test(document.querySelector('.panel__line').textContent));
    const quote = await page.locator('.panel__quote').textContent(); assert.match(quote, /Работа \/ Игры/);
    await hook({ ...question, hook_event_name: 'PostToolUse' });
    await hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'echo independent' } });
    await hook({ hook_event_name: 'Stop', last_assistant_message: 'Other work finished.' });
    await page.waitForTimeout(250); assert.equal(await page.locator('.panel__quote').textContent(), quote);
    await hook({ ...question, tool_name: 'request_user_input', hook_event_name: 'PostToolUse' });
    await page.waitForFunction(() => document.querySelector('#panel').hidden || !/Куда положить папку/.test(document.querySelector('.panel__quote').textContent));
    await hook({ ...question, hook_event_name: 'PreToolUse' });
    await page.locator('.panel__quote').filter({ hasText: 'Куда положить папку?' }).waitFor();
    await hook({ ...question, hook_event_name: 'PostToolUse', tool_response: { isError: true, error: 'Cancelled fixture' } });
    await page.waitForFunction(() => document.querySelector('#panel').dataset.kind === 'error');
    assert.equal(await page.locator('.panel__quote').textContent(), '');
    assert.deepEqual(errors, []);
    console.log('CODEX QUESTION UI PASS: actual stdin hook -> localhost bridge -> alert with question/options, async persistence during tool/Stop events, answer clears alert. No live Codex prompt issued.');
  } finally { if (app) await app.close(); fs.rmSync(temp, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exitCode = 1; });
