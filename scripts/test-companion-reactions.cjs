'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const base = path.resolve(__dirname, '../src/renderer/js');
const uri = text => 'data:text/javascript;base64,' + Buffer.from(text).toString('base64');
const load = name => import(uri(fs.readFileSync(path.join(base, name), 'utf8')));

async function fixture() {
  const { CompanionReactions } = await load('companion-reactions.js');
  let time = 0; const acts = [], speech = [];
  const capri = { mode: 'idle', stance: 'stand', perform: act => acts.push(act) };
  const panel = { visible: false, current: null, say: msg => { speech.push(msg); return true; } };
  const reactions = new CompanionReactions({ capri, panel, now: () => time, choose: lines => lines[0] });
  return { capri, panel, acts, speech, reactions, advance: ms => { time += ms; } };
}

test('launcher success/error, waking and music pauses have distinct gestures and Russian lines', async () => {
  const f = await fixture();
  assert.equal(f.reactions.react('launched', { app: 'Калькулятор' }), true);
  assert.equal(f.acts.at(-1), 'acknowledge'); assert.match(f.speech.at(-1).line, /Калькулятор/);
  f.advance(20000); assert.equal(f.reactions.react('launchError', { error: 'private subscription token' }), true);
  assert.equal(f.acts.at(-1), 'shrug'); assert.ok(!f.speech.at(-1).line.includes('private'));
  f.advance(20000); f.capri.stance = 'sit';
  assert.equal(f.reactions.react('wake'), true); assert.equal(f.acts.at(-1), 'unwind');
  f.advance(20000); f.capri.stance = 'stand';
  f.reactions.musicPlayback(true); f.advance(4000);
  assert.equal(f.reactions.musicPlayback(false), true); assert.equal(f.acts.at(-1), 'settle'); assert.equal(f.speech.at(-1).silent, true);
});

test('reactions never wake naps, displace questions, interrupt gestures or replay after suppression', async () => {
  for (const patch of [{ manualRest: true }, { mode: 'sleep' }, { mode: 'alert' }, { mode: 'work' }, { gameMode: true }, { gameMode: false, gameQuiet: true }, { hidden: true }, { stowed: true }, { dormant: true }, { busy: true }, { dragging: true }, { pointing: {} }, { pinOccluded: true }, { stance: 'fall' }, { act: { player: { priority: 1 } } }]) {
    const f = await fixture(); Object.assign(f.capri, patch);
    assert.equal(f.reactions.react('launched'), false, JSON.stringify(patch)); assert.deepEqual(f.acts, []); assert.deepEqual(f.speech, []);
  }
  const f = await fixture(); f.panel.visible = true; f.panel.current = { kind: 'alert' };
  assert.equal(f.reactions.react('wake'), false); f.panel.visible = false;
  assert.equal(f.reactions.react('launched'), true); f.advance(6000);
  assert.equal(f.reactions.react('launched'), false, 'per-event cooldown');
  f.advance(7000); assert.equal(f.reactions.react('launched'), true);
  f.capri.gameMode = true; f.advance(200000); f.reactions.musicPlayback(true); f.advance(4000);
  assert.equal(f.reactions.musicPlayback(false), false); f.capri.gameMode = false;
  assert.equal(f.reactions.musicPlayback(false), false, 'suppressed pause must not replay after the game');
});

test('new exposure sheets animate and every seated reaction keeps the registered seated drawing', async () => {
  const { ACTS, Player } = await load('acting.js'), { choosePoseArt } = await load('pose-art.js');
  for (const act of ['acknowledge', 'shrug', 'stretch', 'unwind', 'settle']) {
    assert.ok(ACTS[act].keys.length >= 3); const player = new Player(act, { at: 0 });
    assert.notDeepEqual(player.sample(0).pose, player.sample(400).pose, act);
    assert.equal(player.sample(10000), null, 'one-shot gesture must finish');
  }
  for (const act of ['acknowledge', 'shrug', 'unwind', 'settle']) assert.equal(choosePoseArt({ stance: 'sit', mode: 'idle', act }), 'seated');
});

test('game sound suppression stops current/scheduled sources without changing saved audio preference', async () => {
  const util = uri(fs.readFileSync(path.join(base, 'util.js'), 'utf8'));
  const previous = global.matchMedia; global.matchMedia = () => ({ matches: false });
  let Voice;
  try { ({ Voice } = await import(uri(fs.readFileSync(path.join(base, 'voice.js'), 'utf8').replace("'./util.js'", JSON.stringify(util))))); }
  finally { if (previous === undefined) delete global.matchMedia; else global.matchMedia = previous; }
  const voice = new Voice(), stopped = [];
  voice.muted = true; voice.volume = .23; voice.master = { gain: { value: .23 } };
  voice.sources.add({ stop() { stopped.push('running'); } }); voice.sources.add({ stop() { stopped.push('future'); } });
  voice.setSuppressed(true); assert.equal(voice.master.gain.value, 0); assert.equal(voice.sources.size, 0); assert.equal(stopped.length, 2);
  voice.configure({ volume: .41 }); assert.equal(voice.master.gain.value, 0);
  voice.ensure = () => { throw new Error('suppressed cues must not create an AudioContext'); };
  voice.play('alert'); voice.setSuppressed(false);
  assert.equal(voice.volume, .41); assert.equal(voice.muted, true); assert.equal(voice.master.gain.value, .41);
});

test('ordinary Codex work during a game updates sessions without waking a manual nap or moving the pet', async () => {
  const source = fs.readFileSync(path.join(base, 'brain.js'), 'utf8')
    .replaceAll("'./lines.js'", JSON.stringify(uri(fs.readFileSync(path.join(base, 'lines.js'), 'utf8'))))
    .replaceAll("'./util.js'", JSON.stringify(uri(fs.readFileSync(path.join(base, 'util.js'), 'utf8'))));
  const previous = global.matchMedia; global.matchMedia = () => ({ matches: false }); let Brain;
  try { ({ Brain } = await import(uri(source))); }
  finally { if (previous === undefined) delete global.matchMedia; else global.matchMedia = previous; }
  const forbidden = () => { throw new Error('Game-time work must not wake or move Capri'); };
  const capri = { mode: 'sleep', manualRest: true, gameMode: true, windows: { fg: 7, wins: [] }, wake: forbidden, attend: forbidden, goToWork: forbidden, pulse: forbidden, spark: forbidden, teleport: forbidden, celebrate: forbidden, setMode(mode) { if (this.manualRest && ['idle', 'work'].includes(mode)) return; this.mode = mode; } };
  const brain = new Brain({ capri, panel: { say() {}, setTicker() {} }, voice: { play() {} }, host: {}, lang: 'ru' });
  await brain.handle({ session_id: 'quiet-work', hook_event_name: 'UserPromptSubmit', prompt: 'Test quietly' });
  await brain.handle({ session_id: 'quiet-work', hook_event_name: 'PreToolUse', tool_name: 'Bash' });
  await brain.handle({ session_id: 'quiet-work', hook_event_name: 'Stop', last_assistant_message: 'Done' });
  assert.equal(brain.sessions.get('quiet-work').working, false); assert.equal(brain.sessions.get('quiet-work').count, 1);
  assert.equal(capri.manualRest, true); assert.equal(capri.mode, 'sleep'); assert.equal(brain.replyFor, null);
});
