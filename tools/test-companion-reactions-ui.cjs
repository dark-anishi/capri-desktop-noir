'use strict';
// Real renderer/IPC, isolated data, no live VPN/music account or game required.
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { _electron } = require(process.env.CAPRI_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');

async function bootRace({ initial, beforeWiring, duringRefresh, port }) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-reaction-boot-race-')); let app;
  fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ welcomed: true, linked: true, muted: true, wander: false, possess: false, skin: 'mono', lang: 'ru' }));
  const bootstrap = path.join(temp, 'bootstrap.cjs');
  fs.writeFileSync(bootstrap, `
    const { protocol, ipcMain } = require('electron');
    global.bootRace = { stage: 'starting', configs: [], heldAssets: false };
    const originalProtocol = protocol.handle.bind(protocol);
    protocol.handle = (scheme, handler) => originalProtocol(scheme, async request => {
      if (!bootRace.heldAssets && request.url.endsWith('/assets/skins/mono/capri-full.svg')) {
        bootRace.heldAssets = true; bootRace.stage = 'assets';
        await new Promise(resolve => { bootRace.releaseAssets = resolve; });
      }
      return handler(request);
    });
    const originalHandle = ipcMain.handle.bind(ipcMain);
    ipcMain.handle = (channel, handler) => originalHandle(channel, channel !== 'config:get' ? handler : async (...args) => {
      const snapshot = await handler(...args); bootRace.configs.push(snapshot.gameMode);
      if (bootRace.configs.length === 2 && ${typeof duringRefresh === 'boolean'}) {
        bootRace.stage = 'refresh';
        await new Promise(resolve => { bootRace.releaseRefresh = resolve; });
      }
      return snapshot;
    });
    require(${JSON.stringify(path.join(root, 'src/main/windows.js'))}).startWindowWatch = ({onUpdate}) => {
      bootRace.set = active => onUpdate({fg:active?99:0,wins:[],gameMode:active});
      bootRace.set(${initial}); return {stop(){}};
    };
    require(${JSON.stringify(path.join(root, 'src/main/main.js'))});
  `);
  try {
    app = await _electron.launch({ executablePath: require('electron'), args: [bootstrap, '--dev'], cwd: root, env: { ...process.env, CAPRI_TEST_DATA: temp, CAPRI_PORT: String(port) } });
    const page = await app.firstWindow();
    await app.evaluate(async () => { while (bootRace.stage !== 'assets') await new Promise(resolve => setTimeout(resolve, 10)); });
    await page.evaluate(async () => {
      for (const [file, name, method, key] of [['capri','Capri','setScale','bootPet'],['voice','Voice','setSuppressed','bootVoice'],['panel','Panel','setQuiet','bootPanel']]) {
        const Type = (await import('./js/' + file + '.js'))[name], original = Type.prototype[method];
        Type.prototype[method] = function (...args) { window[key] = this; return original.apply(this, args); };
      }
    });
    assert.deepEqual(await app.evaluate(() => bootRace.configs), [initial]);
    await app.evaluate((_electron, active) => { bootRace.set(active); bootRace.releaseAssets(); }, beforeWiring);
    if (typeof duringRefresh === 'boolean') {
      await app.evaluate(async () => { while (bootRace.stage !== 'refresh') await new Promise(resolve => setTimeout(resolve, 10)); });
      await app.evaluate((_electron, active) => bootRace.set(active), duringRefresh);
      await page.waitForFunction(active => window.bootPet?.gameMode === active, duringRefresh);
      await app.evaluate(() => bootRace.releaseRefresh());
    }
    const expected = typeof duringRefresh === 'boolean' ? duringRefresh : beforeWiring;
    await page.waitForFunction(active => window.bootPet?.gameMode === active && window.bootVoice?.suppressed === active && window.bootPanel?.quiet === active, expected);
    // Let the reply and at least several frames settle; a stale reply must not flip it back.
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => bootPet.gameMode), expected);
    assert.deepEqual(await app.evaluate(() => bootRace.configs.slice(0, 2)), [initial, beforeWiring]);
    const native = await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/renderer/')); return { muted: win.webContents.isAudioMuted(), visible: win.isVisible() }; });
    assert.equal(native.muted, expected); assert.equal(native.visible, !expected);
    console.log(`BOOT GAME RACE PASS: ${initial}->${beforeWiring} while assets load${typeof duringRefresh === 'boolean' ? ', newer ' + duringRefresh + ' during fresh config read' : ''}; renderer and native visibility/audio agree.`);
  } catch (error) {
    if (app) {
      console.error('Boot race main diagnostics', await app.evaluate(() => ({ stage: bootRace.stage, configs: bootRace.configs })));
      for (const page of app.windows()) if (page.url().includes('/renderer/')) console.error('Boot race renderer diagnostics', await page.evaluate(() => ({ gameMode: window.bootPet?.gameMode, voice: window.bootVoice?.suppressed, panel: window.bootPanel?.quiet })));
    }
    throw error;
  } finally {
    if (app) await app.close();
    assert.ok(temp.startsWith(path.join(os.tmpdir(), 'capri-reaction-boot-race-'))); fs.rmSync(temp, { recursive: true, force: true });
  }
}

(async () => {
  await bootRace({ initial: true, beforeWiring: false, port: 47838 });
  await bootRace({ initial: false, beforeWiring: true, port: 47838 });
  await bootRace({ initial: false, beforeWiring: false, duringRefresh: true, port: 47838 });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-reaction-ui-')); let app;
  fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ welcomed: true, linked: true, muted: true, wander: false, possess: false, skin: 'mono', lang: 'ru' }));
  try {
    app = await _electron.launch({ executablePath: require('electron'), args: [root, '--dev'], cwd: root, env: { ...process.env, CAPRI_TEST_DATA: temp, CAPRI_PORT: '47836' } });
    const page = await app.firstWindow(), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.waitForFunction(() => Boolean(window.host));
    // A fixed delay or the initial busy=false frame can race assets + the fresh
    // config read. The startup panel is emitted only after intro() has finished.
    await page.waitForFunction(() => { const panel = document.getElementById('panel'); return panel && !panel.hidden && panel.querySelector('.panel__line').textContent.length > 0; }, null, { timeout: 45000 });
    await page.waitForFunction(() => document.getElementById('sprite')?.dataset.busy === 'false', null, { timeout: 45000 });
    await page.evaluate(async () => {
      const [{ Capri }, { Panel }, { Voice }, { Brain }, { CompanionReactions }] = await Promise.all(['capri', 'panel', 'voice', 'brain', 'companion-reactions'].map(name => import('./js/' + name + '.js')));
      for (const [prototype, method, key] of [[Capri.prototype, 'drawFrame', 'reactionPet'], [Panel.prototype, 'say', 'reactionPanel'], [Voice.prototype, 'setSuppressed', 'reactionVoice'], [Brain.prototype, 'handle', 'reactionBrain'], [CompanionReactions.prototype, 'react', 'reactionController']]) {
        const original = prototype[method]; prototype[method] = function (...args) {
          window[key] = this;
          if (key !== 'reactionController') return original.apply(this, args);
          const c = this.capri;
          window.lastReactionAttempt = { name: args[0], mode: c.mode, stance: c.stance, gameMode: c.gameMode, busy: c.busy, hidden: c.hidden, stowed: c.stowed, dormant: c.dormant, dragging: c.dragging, manualRest: c.manualRest, pinOccluded: c.pinOccluded, pointing: Boolean(c.pointing), act: c.act?.player.name, priority: c.act?.player.priority, panelVisible: this.panel.visible, panelKind: this.panel.current?.kind, lastAny: this.lastAny, lastEvent: this.last.get(args[0]), now: this.now() };
          const accepted = original.apply(this, args); window.lastReactionAttempt.accepted = accepted;
          return accepted;
        };
      }
    });
    const command = cmd => app.evaluate(({ BrowserWindow }, cmd) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/renderer/')).webContents.send('capri:command', cmd), cmd);
    const codex = evt => app.evaluate(({ BrowserWindow }, evt) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/renderer/')).webContents.send('codex:event', evt), evt);
    await command({ name: 'pose', hush: true, still: true, stance: 'stand' });
    await page.waitForFunction(() => Boolean(window.reactionPet));
    await page.evaluate(() => {
      // This gate injects event-driven reactions, not autonomous cursor/idle
      // gestures. In particular notice() may otherwise race the first launch.
      reactionPet.setWindows = () => {}; reactionPet.behave = () => {};
      reactionPet.nextMove = reactionPet.nextGaze = reactionPet.nextTwitch = reactionPet.nextShed = reactionPet.nextNotice = Infinity;
      reactionPet.endAct(false); reactionPet.wake(); reactionPet.setMode('idle');
    });
    await command({ name: 'launcherSpeech', action: 'launched', app: 'Regression App' });
    await page.waitForFunction(() => window.lastReactionAttempt?.name === 'launched');
    const firstAttempt = await page.evaluate(() => lastReactionAttempt);
    assert.equal(firstAttempt.accepted, true, JSON.stringify(firstAttempt));
    await page.waitForFunction(() => window.reactionPet.act?.player.name === 'acknowledge' && window.reactionPanel.current?.line.includes('Regression App'));
    const gpu = await page.evaluate(() => {
      const c = reactionPet, gl = c.sprite.gl, start = performance.now(); c.act.player.start = start;
      c.drawFrame(start); const first = new Uint8Array(c.canvas.width * c.canvas.height * 4); gl.readPixels(0, 0, c.canvas.width, c.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, first);
      c.drawFrame(start + 300); const next = new Uint8Array(first.length); gl.readPixels(0, 0, c.canvas.width, c.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, next);
      let changed = 0; for (let i = 3; i < first.length; i += 4) if (Math.abs(first[i] - next[i]) > 30) changed++;
      return { changed, error: gl.getError() };
    });
    assert.ok(gpu.changed > 20, JSON.stringify(gpu)); assert.equal(gpu.error, 0);
    await page.evaluate(() => {
      reactionPet.endAct(false); reactionPanel.hide(); reactionController.lastAny = -Infinity;
      reactionPet.pos = { x: 450, y: 540 }; reactionPet.setStance('sit', { perch: { id: -36, dx: 250 } }); reactionPet.rest();
    });
    await command({ name: 'launcherSpeech', action: 'launched', app: 'Must not wake' });
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(() => reactionPet.mode === 'sleep' && reactionPet.manualRest), true);
    await command({ name: 'petRest', sleeping: false });
    await page.waitForFunction(() => reactionPet.act?.player.name === 'unwind');
    assert.equal(await page.evaluate(() => { reactionPet.drawFrame(); return reactionPet.stance === 'sit' && reactionPet.sprite.poseName === 'seated'; }), true);
    await page.evaluate(() => { reactionPet.endAct(false); reactionPanel.hide(); reactionController.lastAny = -Infinity; });
    const opened = app.waitForEvent('window'); await page.evaluate(() => window.host.openMenu()); const menu = await opened;
    await menu.waitForFunction(() => Boolean(window.launcher));
    const failedLaunch = await menu.evaluate(() => window.launcher.launch('nonexistent-reaction-fixture'));
    assert.equal(failedLaunch.ok, false);
    await page.waitForFunction(() => reactionPet.act?.player.name === 'shrug');
    assert.equal(await page.evaluate(() => reactionPanel.current.kind === 'error' && !reactionPanel.current.line.includes('Private')), true);
    await page.evaluate(() => { reactionPet.endAct(false); reactionPanel.hide(); reactionController.lastAny = -Infinity; });
    await command({ name: 'musicPlayback', playing: true });
    await page.waitForFunction(() => reactionPet.musicPlaying);
    await page.evaluate(() => { reactionController.musicStartedAt = performance.now() - 4000; });
    await command({ name: 'musicPlayback', playing: false });
    await page.waitForFunction(() => reactionPet.act?.player.name === 'settle' && reactionPanel.current?.silent);

    // Capture the actual Voice instance and test real scheduled AudioBufferSources.
    await command({ name: 'gameMode', active: false });
    await page.evaluate(async () => {
      const { Voice } = await import('./js/voice.js');
      const c = reactionPet;
      // Audio is owned by the live Capri instance; this capture does not expose it to main.
      const voice = c.voice; window.reactionVoice = voice;
      const ctx = voice.ensure(), source = ctx.createBufferSource(); source.buffer = ctx.createBuffer(1, 48000, 48000);
      voice.track(source); source.start(ctx.currentTime + 10); window.beforeReactionAudio = { muted: voice.muted, volume: voice.volume };
      c.endAct(false); reactionPanel.hide();
    });
    const hitPoint = await page.evaluate(() => {
      const c = reactionPet; c.drawFrame();
      for (let y = c.pos.y - 120; y < c.pos.y - 10; y += 5) for (let x = c.pos.x - 40; x < c.pos.x + 40; x += 5) {
        if ([[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2]].every(([dx, dy]) => c.hit(x + dx, y + dy))) return { x, y, inside: true };
      }
      throw new Error('No solid character point for click-through regression');
    });
    await app.evaluate(({ ipcMain }, point) => {
      global.reactionHitCalls = []; global.reactionCursor = point;
      ipcMain.on('overlay:interactive', (_event, interactive) => reactionHitCalls.push(interactive));
      ipcMain.removeHandler('overlay:cursor'); ipcMain.handle('overlay:cursor', () => reactionCursor);
    }, hitPoint);
    await page.evaluate(point => window.dispatchEvent(new MouseEvent('mousemove', { clientX: point.x, clientY: point.y })), hitPoint);
    await app.evaluate(async () => { for (let i = 0; reactionHitCalls.at(-1) !== true && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 10)); });
    assert.equal(await app.evaluate(() => reactionHitCalls.at(-1)), true);
    await command({ name: 'gameMode', active: true });
    await page.waitForFunction(() => reactionPet.gameMode && reactionVoice.suppressed && reactionPanel.quiet);
    assert.equal(await page.evaluate(() => reactionVoice.sources.size), 0);
    await app.evaluate(async () => { for (let i = 0; reactionHitCalls.at(-1) !== false && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 10)); });
    assert.equal(await app.evaluate(() => reactionHitCalls.at(-1)), false);
    await command({ name: 'gameMode', active: false });
    await app.evaluate(async () => { for (let i = 0; reactionHitCalls.at(-1) !== true && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 10)); });
    assert.equal(await app.evaluate(() => reactionHitCalls.at(-1)), true, 'stationary cursor must become clickable again immediately after the game');
    await command({ name: 'gameMode', active: true });
    await page.waitForFunction(() => reactionPet.gameMode);
    await command({ name: 'launcherSpeech', action: 'launched', app: 'Stale game-time launch' });
    await page.evaluate(() => reactionPet.rest());
    await codex({ session_id: 'quiet-work', hook_event_name: 'UserPromptSubmit', prompt: 'Work without disturbing the game' });
    await codex({ session_id: 'quiet-work', hook_event_name: 'PreToolUse', tool_name: 'Bash' });
    await codex({ session_id: 'quiet-work', hook_event_name: 'Stop', last_assistant_message: 'Done' });
    await page.waitForFunction(() => window.reactionBrain?.sessions.get('quiet-work')?.working === false);
    assert.equal(await page.evaluate(() => reactionPet.mode === 'sleep' && reactionPet.manualRest && reactionPet.stance === 'sit'), true);
    const question = { session_id: 'reaction-game', hook_event_name: 'Notification', notification_type: 'agent_needs_input', question_id: 'q1', message: 'Still waiting?' };
    await codex(question);
    await page.waitForFunction(() => window.reactionBrain?.sessions.get('reaction-game')?.waiting && reactionPanel.current?.kind === 'alert');
    assert.equal(await page.evaluate(() => reactionPanel.visible), false);
    assert.equal(await page.evaluate(() => reactionPet.act), null);
    await command({ name: 'gameMode', active: false });
    await page.waitForFunction(() => !reactionPanel.quiet && reactionPanel.visible && reactionPanel.current?.silent);
    assert.equal(await page.evaluate(() => reactionPanel.current.quote.includes('Still waiting?') && reactionVoice.muted === beforeReactionAudio.muted && reactionVoice.volume === beforeReactionAudio.volume && reactionVoice.sources.size === 0), true);
    await command({ name: 'gameMode', active: true });
    await codex({ ...question, hook_event_name: 'CapriQuestionAnswered' });
    await page.waitForFunction(() => !reactionBrain.sessions.get('reaction-game').waiting && !reactionPanel.current);
    await command({ name: 'gameMode', active: false });
    await page.waitForFunction(() => !reactionPanel.quiet);
    assert.equal(await page.evaluate(() => reactionPanel.current), null);
    assert.deepEqual(errors, []);
    console.log('COMPANION REACTIONS UI PASS: launch nod changes real GPU alpha, seated wake/error/music pause keep the drawn seat, naps resist library feedback, game mode stops scheduled WebAudio and routine speech, pending Codex questions survive silently and answered ones do not return. Isolated data, no live networking.');
  } catch (error) {
    if (app) for (const page of app.windows()) if (page.url().includes('/renderer/')) console.error('Reaction UI diagnostics', await page.evaluate(() => ({ capri: window.reactionPet && { mode: reactionPet.mode, busy: reactionPet.busy, hidden: reactionPet.hidden, stowed: reactionPet.stowed, dormant: reactionPet.dormant, dragging: reactionPet.dragging, manualRest: reactionPet.manualRest, pinOccluded: reactionPet.pinOccluded, gameMode: reactionPet.gameMode, stance: reactionPet.stance, pointing: Boolean(reactionPet.pointing), act: reactionPet.act?.player.name }, panel: window.reactionPanel && { current: reactionPanel.current?.kind, line: reactionPanel.current?.line, quiet: reactionPanel.quiet, visible: reactionPanel.visible }, controller: Boolean(window.reactionController), lastAttempt: window.lastReactionAttempt })));
    throw error;
  } finally {
    if (app) await app.close();
    assert.ok(temp.startsWith(path.join(os.tmpdir(), 'capri-reaction-ui-'))); fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
