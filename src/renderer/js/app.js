import { Capri } from './capri.js';
import { FxLayer } from './fx.js';
import { Chip, Mask } from './chip.js';
import { Panel } from './panel.js';
import { Voice } from './voice.js';
import { Brain } from './brain.js';
import { Guide } from './guide.js';
import { LINES } from './lines.js';
import { LAUNCHER_LINES } from './launcher-lines.js';
import { loadPoseArt } from './pose-art.js';
import { CompanionReactions } from './companion-reactions.js';
import { pick, fmt } from './util.js';

const host = window.host;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// close-ups of her for the cut-ins, frames of the show (tools/build-cutins.py)
const CUTINS = ['grin', 'laugh', 'eyes', 'many', 'look'];

async function boot() {
  const config = await host.getConfig();
  const skinAsset = (skin, name) => skin === 'mono' ? `../../assets/skins/mono/${name.replace('.png', '.svg')}` : `../../assets/capri/${name}`;
  const [image, intro, ...cutins] = await Promise.all([
    loadImage(skinAsset(config.skin, 'capri-full.png')),
    loadImage('../../assets/capri/intro-face.webp').catch(() => null), // her intro, frames of the show
    ...CUTINS.map((name) => loadImage(skinAsset(config.skin, `cutin-${name}.png`))),
    document.fonts.load('600 16px "Chakra Petch"'),
    document.fonts.load('400 11px "JetBrains Mono"'),
  ]);
  document.documentElement.lang = config.lang;
  const poseImages = await loadPoseArt(config.skin, loadImage);
  document.documentElement.dataset.skin = config.skin;

  const fx = new FxLayer(document.getElementById('fx'), {
    cutins: Object.fromEntries(CUTINS.map((name, i) => [name, cutins[i]])),
    intro,
    skin: config.skin,
  });
  fx.resize(innerWidth, innerHeight);
  const chip = new Chip(document.getElementById('chip'));
  chip.place(innerWidth, innerHeight);
  const mask = new Mask(document.getElementById('mask'));

  const voice = new Voice();
  voice.configure(config);
  host.listSounds().then((list) => list.length && voice.loadCustom(list));

  const panel = new Panel({
    panel: document.getElementById('panel'),
    ticker: document.getElementById('ticker'),
    labels: LINES[config.lang] || LINES.fr,
  });

  const capri = new Capri({
    root: document.getElementById('capri'),
    canvas: document.getElementById('sprite'),
    image,
    poseImages,
    fx,
    voice,
  });
  panel.skin = config.skin;
  let currentSkin = config.skin;
  let skinRevision = 0;
  async function changeSkin(skin) {
    const revision = ++skinRevision;
    if (skin === currentSkin) return;
    const [sprite, ...frames] = await Promise.all([
      loadImage(skinAsset(skin, 'capri-full.png')),
      ...CUTINS.map((name) => loadImage(skinAsset(skin, `cutin-${name}.png`))),
    ]);
    const poses = await loadPoseArt(skin, loadImage);
    if (revision !== skinRevision) return;
    capri.setArtwork(sprite, poses);
    fx.setSkin(skin);
    fx.cutins = Object.fromEntries(CUTINS.map((name, i) => [name, frames[i]]));
    panel.skin = skin;
    if (panel.current) panel.setFace(panel.current.face || 'grin');
    document.documentElement.dataset.skin = skin;
    currentSkin = skin;
  }
  capri.wander = config.wander;
  capri.possessWindows = config.possess;
  capri.setScale(config.scale);

  const brain = new Brain({ capri, panel, voice, host, lang: config.lang });
  const reactions = new CompanionReactions({ capri, panel, language: () => brain.lang });
  let gameStateRevision = 0;
  const applyGameMode = (active, quiet = active) => {
    active = active === true;
    quiet = quiet === true;
    if (capri.gameMode === active && capri.gameQuiet === quiet) return;
    capri.gameMode = active; capri.gameQuiet = quiet;
    voice.setSuppressed(quiet); panel.setQuiet(quiet);
    capri.endAct(false); fx.clear();
    refreshHit();
  };
  const wakePet = () => {
    const sleeping = capri.mode === 'sleep';
    capri.wake();
    if (sleeping) reactions.react('wake');
  };

  // Click-through everywhere except on her body, the panel and her biochip.
  let interactive = false;
  let mouse = null;
  const setInteractive = (on) => {
    if (on === interactive) return;
    interactive = on;
    host.setInteractive(on);
  };
  const onChip = () => Boolean(chip.visible && mouse && chip.contains(mouse.x, mouse.y, 0));
  const refreshHit = () => {
    if (capri.gameMode) return setInteractive(false);
    if (capri.pointerHeld || capri.dragging) return setInteractive(true);
    if (!mouse) return setInteractive(false);
    const r = panel.rect();
    const onPanel = r && mouse.x >= r.left && mouse.x <= r.right && mouse.y >= r.top && mouse.y <= r.bottom;
    document.body.style.cursor = onChip() ? 'pointer' : '';
    return setInteractive(Boolean(onPanel || capri.hit(mouse.x, mouse.y) || onChip()));
  };
  // Her biochip: her eyes on it follow the pointer over it, and she comes out when you click it
  // (only then, so the pointer passing through that corner doesn't call her back).
  // Her mask, asleep: the pointer coming over it stirs her, and a moment of that wakes her up.
  let wakeTimer = 0;
  const comeOut = () => {
    if (capri.stowed) host.setConfig({ visible: true }); // the tray and Ctrl+Alt+C follow
    capri.unstow();
  };
  const hoverChip = () => {
    chip.pointer = chip.visible && mouse && chip.contains(mouse.x, mouse.y) ? mouse : null;
    const near = mask.visible && mouse && mask.contains(mouse.x, mouse.y, 30);
    mask.pointer = near ? mouse : null;
    if (!near) {
      clearTimeout(wakeTimer);
      wakeTimer = 0;
    } else if (!wakeTimer) {
      wakeTimer = setTimeout(() => {
        wakeTimer = 0;
        if (capri.dormant) capri.wake();
      }, 400);
    }
  };
  window.addEventListener('mousemove', (e) => {
    mouse = { x: e.clientX, y: e.clientY };
    refreshHit();
    hoverChip();
  });
  document.addEventListener('mouseleave', () => {
    mouse = null;
    refreshHit();
    hoverChip();
  });
  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (chip.visible && chip.contains(e.clientX, e.clientY, 0)) host.openMenu();
  });
  window.addEventListener('click', (e) => {
    if (chip.visible && chip.contains(e.clientX, e.clientY, 0)) comeOut();
  });

  // OLE file drags do not reliably forward mousemove through a transparent window.
  // Poll the native cursor so only her silhouette becomes a drop target.
  let cursorPending = false;
  setInterval(async () => {
    if (cursorPending || capri.dragging) return;
    cursorPending = true;
    try {
      const p = await host.cursor();
      mouse = p.inside ? p : null; refreshHit();
    } catch { /* The overlay may be closing. */ }
    finally { cursorPending = false; }
  }, 80);
  const dropRoot = document.getElementById('capri');
  let dropHintTimer = 0;
  const clearDropHint = () => { clearTimeout(dropHintTimer); dropRoot.classList.remove('shortcut-hover'); };
  const isShortcutTarget = (e) => capri.hit(e.clientX, e.clientY) && [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    const accepts = isShortcutTarget(e);
    e.dataTransfer.dropEffect = accepts ? 'copy' : 'none';
    clearDropHint();
    if (accepts) { dropRoot.classList.add('shortcut-hover'); dropHintTimer = setTimeout(clearDropHint, 220); }
  });
  window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) clearDropHint(); });
  window.addEventListener('drop', async (e) => {
    e.preventDefault(); clearDropHint();
    if (!isShortcutTarget(e)) return;
    try { await host.dropShortcuts([...e.dataTransfer.files]); }
    catch { /* Native main reports import failures through Capri's speech. */ }
  });

  // wiring
  capri.onMove = (head) => {
    // pointing at something: the panel goes on her other side, so it doesn't cover it
    panel.setAnchor({
      ...head, lean: capri.pointing ? -capri.pointing.dir : 0,
      // Keep seated dialogue beside the complete silhouette, including her hair.
      seated: capri.stance === 'sit',
      body: { left: capri.pos.x - 132 * capri.scale, right: capri.pos.x + 132 * capri.scale },
    }, capri.view);
    // she may have moved out from under a still pointer: never leave a dead click zone behind
    refreshHit();
  };
  capri.onTeleport = (phase) => (phase === 'start' ? panel.suspend() : panel.resume());
  capri.chipAt = () => chip.center();
  capri.onStow = () => {
    chip.setMode(capri.mode);
    chip.show();
  };
  capri.onUnstow = () => chip.hide();
  capri.onDoze = (phase, face) => {
    if (phase === 'start') {
      mask.place(face.x, face.y, capri.scale * 1.1);
      mask.show();
    } else if (phase === 'waking') {
      mask.wake();
    } else {
      mask.hide();
    }
  };
  capri.onMode = (mode, prev) => chip.setMode(mode, prev);
  capri.onPetState = (state) => host.petState(state);
  capri.publishPetState();
  // now and then she says something about the satellite: while she looks at it, or once
  // the red light has gone up (never during, nothing should cover that)
  capri.onGaze = (when) => {
    const lines = when === 'end' ? brain.t.uplink : brain.t.gaze;
    if (!panel.visible && Math.random() < (when === 'end' ? 0.6 : 0.4)) panel.say({ kind: 'info', line: pick(lines), hold: 3800 });
  };
  capri.onClick = () => {
    if (capri.mode === 'sleep') { wakePet(); return; }
    if (panel.visible) panel.hide();
    else { if (capri.mode === 'idle') capri.perform('wave'); brain.status(); }
  };
  panel.onChar = (kind) => { if (!panel.current?.silent) voice.play('blip', { mood: kind }); };
  panel.onTalk = (talking) => talking && capri.perform('talk');
  capri.onMenu = () => host.openMenu();
  capri.onQuickMenu = () => host.openQuickMenu();

  // Her guide (guide.js): her welcome on first launch, and "How does it work?" in her menu,
  // where she takes you to things and points at them.
  const guide = new Guide({ capri, panel, voice, host, brain });
  // the first Codex event that ever reaches her: so you know it worked
  brain.linked = config.linked;
  brain.onLinked = () => {
    host.setConfig({ linked: true, welcomed: true });
    voice.play('hello');
    capri.perform('wave');
    panel.say({ kind: 'done', badge: 'LINK', line: brain.t.welcome.linked, hold: 6000 });
  };

  // The demo's second half, after its fake Codex session: everything she does on her own, one
  // after the other, a line before each.
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (done, max = 15000) => {
    for (const t0 = Date.now(); !done() && Date.now() - t0 < max;) await wait(100);
  };
  const free = () => !capri.busy && !capri.act && capri.stance !== 'fall';
  brain.onShowcase = async () => {
    const t = brain.t.showcase;
    const caption = (line) => panel.say({ kind: 'info', line, hold: 2200 });
    capri.nextMove = capri.nextGaze = performance.now() + 120000; // nothing of her own in between
    if (capri.stowed) await capri.unstow();
    if (capri.dormant) capri.wake();
    await until(free);
    panel.hide();

    caption(t.minds);
    await wait(1000);
    await capri.perform('split');
    await wait(900);

    caption(t.zap);
    await wait(1000);
    const h = capri.head();
    capri.zap(h.x + capri.towardCenter() * 280, h.y - 170);
    await wait(1800);

    panel.hide();
    if (capri.gaze({ big: true })) await until(() => !capri.sky);
    await wait(2500);

    // a little terminal opens for her to take over, and closes under her once she's done with it
    if (capri.possessWindows && (await host.demoWindow(true))) {
      const top = () => capri.windows.wins.find((w) => capri.canSit(w)); // it opens on top of everything
      await until(top, 4000);
      const win = top();
      const seat = win && { win, dx: win.w * 0.4 };
      if (seat) {
        panel.hide();
        await capri.sitOn(seat);
        await until(free);
        caption(t.possess);
        await wait(1400);
        panel.hide();
        await capri.possess();
        await wait(1800);
      }
      host.demoWindow(false);
      await wait(400);
      await until(free); // she may have fallen off it
      await wait(900);
    }

    caption(t.sleep);
    await wait(1400);
    panel.hide();
    capri.setMode('sleep');
    await wait(2500); // dozing off
    await capri.doze();
    await wait(4500);
    capri.wake();
    await until(free);
    await wait(1200);

    caption(t.chip);
    await wait(1600);
    panel.hide();
    await capri.stow();
    await wait(3500);
    await capri.unstow();
    await wait(600);
    panel.say({ kind: 'info', line: t.end, hold: 5000 });
  };

  host.onCodexEvent((evt) => brain.handle(evt));
  host.onWindows((data) => {
    capri.setWindows(data);
    brain.onWindows(data);
  });
  // the windows as they are now: the watcher only speaks again when something changes
  host.windowsNow().then((data) => data && capri.setWindows(data));

  host.onResize(({ width, height }) => {
    fx.resize(width, height);
    chip.place(width, height);
    capri.setView(width, height);
  });
  window.addEventListener('resize', () => {
    fx.resize(innerWidth, innerHeight);
    chip.place(innerWidth, innerHeight);
    capri.setView(innerWidth, innerHeight);
  });

  host.onConfig((cfg) => {
    if (typeof cfg.gameMode === 'boolean') { gameStateRevision++; applyGameMode(cfg.gameMode, cfg.gameQuiet); }
    changeSkin(cfg.skin).catch((err) => console.error('Skin:', err));
    voice.configure(cfg);
    capri.wander = cfg.wander;
    capri.possessWindows = cfg.possess;
    if (cfg.scale !== capri.scale) capri.setScale(cfg.scale);
    if (cfg.lang !== brain.lang) {
      brain.lang = cfg.lang;
      panel.labels = LINES[cfg.lang] || LINES.fr;
      document.documentElement.lang = cfg.lang;
    }
  });

  host.onCommand(async (cmd) => {
    const t = brain.t;
    switch (cmd.name) {
      case 'gameMode': {
        gameStateRevision++; applyGameMode(cmd.active, cmd.quiet);
        break;
      }
      case 'preparePin': capri.preparePin(cmd.windowId); break;
      case 'pinWindow': await capri.pinWindow(cmd.pinned === true); break;
      case 'petRest':
        if (cmd.sleeping) capri.rest();
        else wakePet();
        break;
      case 'musicPlayback':
        capri.setMusicPlaying(cmd.playing === true);
        reactions.musicPlayback(cmd.playing === true);
        break;
      case 'launcherSpeech': {
        // Ordinary library feedback must not wake a manual nap or hidden pet.
        if (capri.gameQuiet || capri.gameMode || capri.manualRest || capri.mode === 'sleep' || capri.hidden || capri.stowed || capri.dormant) break;
        if (cmd.action === 'launched' || cmd.action === 'launchError') {
          reactions.react(cmd.action === 'launched' ? 'launched' : 'launchError', cmd);
          break;
        }
        const phrases = LAUNCHER_LINES[brain.lang] || LAUNCHER_LINES.en;
        const action = cmd.action === 'skin' ? cmd.skin : cmd.action;
        if (action === 'open' && capri.mode === 'sleep') break;
        const lines = phrases[action];
        if (lines) {
          capri.wake();
          const failed = ['error', 'vpnError'].includes(cmd.action);
          capri.perform(failed ? 'curious' : 'talk');
          panel.say({ kind: failed ? 'error' : 'info', line: fmt(pick(lines), cmd), face: failed ? 'wide' : 'grin', hold: 5500 });
        }
        break;
      }
      case 'teleport':
        capri.teleport(capri.spot('random'));
        break;
      case 'status':
        brain.status();
        break;
      case 'welcome': // "How does it work?" in her menu
        guide.menu();
        break;
      case 'fakeCodex': { // --dev: the topmost window (the test window) is where a prompt was typed, and you're elsewhere
        const win = capri.windows.wins[0];
        if (win) {
          brain.sessions.set('dev', { id: 'dev', project: 'dev', taskStart: Date.now(), count: 0, files: new Set(), log: [], working: true, waiting: false, window: win.id, seen: Date.now() });
          capri.windows = { ...capri.windows, fg: -1 };
        }
        break;
      }
      case 'guide': // --dev: one topic of her guide (welcome, menu, connect, icon, codex, folder)
        if (cmd.topic === 'welcome') guide.welcome();
        else if (cmd.topic === 'menu') guide.menu();
        else if (typeof guide[cmd.topic] === 'function') guide.scene(() => guide[cmd.topic]());
        break;
      case 'stow': // Ctrl+Alt+C: into her biochip, or back out
        if (cmd.on) capri.stow();
        else capri.unstow();
        break;
      case 'satellite': // the whole sequence, on demand (tray)
        if (capri.stowed) {
          host.setConfig({ visible: true });
          await capri.unstow();
        }
        capri.wake();
        if (capri.stance === 'peek') await capri.unpeek();
        if (!capri.gaze({ big: true })) setTimeout(() => capri.gaze({ big: true }), 1500);
        break;
      case 'hooks':
        if (cmd.ok) panel.say({ kind: 'info', line: cmd.action === 'install' ? t.hooksOk : t.hooksRemoved, hold: 6000 });
        else panel.say({ kind: 'error', line: fmt(t.hooksFail, { error: cmd.error }), hold: 9000 });
        break;
      // --dev helpers
      case 'intro': // her intro again, as when she starts (still: as with Windows' animations off)
        panel.hide();
        await capri.intro(capri.spot('post'), cmd.still ? { still: true } : {});
        break;
      case 'pose':
        capri.debug = cmd.params || null;
        if (cmd.still) capri.nextMove = capri.nextGaze = Infinity; // no wandering off mid-test
        if (cmd.hush) {
          panel.setTicker(null);
          panel.hide();
        }
        if (cmd.scale) capri.setScale(cmd.scale);
        if (cmd.stance) capri.setStance(cmd.stance, cmd);
        if (cmd.at) capri.pos = cmd.at;
        if (cmd.facing) capri.facing = cmd.facing;
        capri.drawFrame();
        break;
      case 'config': // a setting, as if changed from her menu
        host.setConfig(cmd.patch || {});
        break;
      case 'focus': // as if window `fg` had come to the front
        capri.windows = { ...capri.windows, fg: cmd.fg };
        brain.onWindows(capri.windows);
        break;
      case 'freeze':
        capri.hidden = Boolean(cmd.on);
        break;
      case 'act':
        // behaviours by method name (gaze, celebrate, hurt, shed, peek, fall, wanderStep...) or acts by name
        if (cmd.act === 'sit') {
          // pile: n-th window she could sit on from the top of the pile (0: the --dev test window
          // opened last), instead of the usual choice
          const top = cmd.pile !== undefined && capri.windows.wins.filter((w) => capri.canSit(w))[cmd.pile];
          const seat = top ? { win: top, dx: top.w * 0.4 } : capri.pickSeat();
          if (seat) capri.sitOn(seat);
        } else if (typeof capri[cmd.act] === 'function') capri[cmd.act](...(cmd.args || []));
        else capri.perform(cmd.act, cmd.dir || 0);
        break;
      default:
        break;
    }
  });

  // entrance: her face big in the corner says hi, then she dives down to her spot
  // (put away last time: she starts in her biochip)
  // Images/fonts can outlive a foreground change that happened before listeners
  // were wired. Read main again; a newer pushed state wins over an in-flight read.
  const gameRevision = gameStateRevision;
  const currentConfig = await host.getConfig();
  if (gameStateRevision === gameRevision) applyGameMode(currentConfig.gameMode, currentConfig.gameQuiet);
  if (config.visible === false) capri.stowNow();
  else if (intro) await capri.intro(capri.spot('post'));
  else await capri.materialize(capri.spot('post'));
  const hooks = await host.hooksStatus();
  if (!config.welcomed || !hooks.installed) guide.welcome();
  else if (panel.current?.kind !== 'alert') panel.say({ kind: 'info', line: pick(brain.t.online), hold: 4000 });
}

boot().catch((err) => {
  console.error('[capri] boot failed', err);
});
