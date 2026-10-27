'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { quickTemplate, createQuickMenu } = require('../src/main/quick-menu');
const pet = { pinned: false, canPin: true, sleeping: false, canRest: true };
const vpn = { phase: 'connected', activeId: 'profile', settings: { mode: 'rule' }, favorites: ['Sweden', 'Germany & Co'], proxies: [
  { name: 'GLOBAL', type: 'Selector', now: 'DIRECT', all: ['DIRECT', 'Sweden', 'Germany & Co'] },
  { name: 'My VPN', type: 'Selector', now: 'Sweden', all: ['Sweden', 'Germany & Co', 'France'] },
] };
function all(items) { return items.flatMap((item) => [item, ...all(item.submenu || [])]); }
function find(items, id) { return all(items).find((item) => item.id === id); }
test('quick menu offers actual VPN toggle and only favorites in the effective selector', async () => {
  const called = [], actions = new Proxy({}, { get: (_, name) => (...args) => called.push([name, ...args]) });
  const menu = quickTemplate({ vpn, pet, music: { ready: true, playing: true } }, actions);
  assert.equal(find(menu, 'quick-vpn-toggle').label, 'Отключить VPN');
  const favorites = all(menu).filter((i) => i.id?.startsWith('quick-favorite:'));
  assert.deepEqual(favorites.map((i) => i.label), ['Sweden', 'Germany & Co']);
  assert.equal(favorites[0].checked, true); favorites[1].click();
  assert.deepEqual(called.pop(), ['selectProxy', 'My VPN', 'Germany & Co']);
  find(menu, 'quick-vpn-toggle').click(); assert.deepEqual(called.pop(), ['vpnToggle', true]);
  find(menu, 'quick-music-toggle').click(); assert.deepEqual(called.pop(), ['musicToggle']);
  assert.equal(find(menu, 'quick-music-toggle').label, 'Пауза');
  find(menu, 'quick-pin').click(); assert.deepEqual(called.pop(), ['pin', true]);
  find(menu, 'quick-rest').click(); assert.deepEqual(called.pop(), ['rest', true]);
  const global = quickTemplate({ vpn: { ...vpn, settings: { mode: 'global' } }, pet, music: {} }, actions);
  find(global, 'quick-favorite:0:0').click(); assert.deepEqual(called.pop(), ['selectProxy', 'GLOBAL', 'Sweden']);
});
test('unavailable, busy and sleeping states disable unsafe actions while keeping settings accessible', () => {
  const actions = {}, menu = quickTemplate({ vpn: null, pet: { ...pet, canPin: false, canRest: false }, music: {} }, actions);
  assert.equal(find(menu, 'quick-vpn-toggle').enabled, false); assert.equal(find(menu, 'quick-pin').enabled, false);
  assert.equal(find(menu, 'quick-music-toggle').enabled, false); assert.ok(find(menu, 'quick-vpn-open'));
  const asleep = quickTemplate({ vpn, pet: { ...pet, pinned: true, sleeping: true }, music: {}, busy: { vpn: true, pet: true } }, actions);
  assert.equal(find(asleep, 'quick-rest').label, 'Проснуться'); assert.equal(find(asleep, 'quick-pin').label, 'Открепить от окна');
  assert.equal(find(asleep, 'quick-rest').enabled, false); assert.equal(find(asleep, 'quick-vpn-toggle').enabled, false);
});

test('Zapret, VPN, music and pet busy states affect only their own actions', () => {
  const zapret = { phase: 'stopped', supported: true, batches: ['general.bat'] };
  for (const group of ['vpn', 'zapret', 'music', 'pet']) {
    const menu = quickTemplate({ vpn, zapret, pet, music: { ready: true }, busy: { [group]: true } }, {});
    assert.equal(find(menu, 'quick-vpn-toggle').label, group === 'vpn' ? 'VPN — подключение…' : 'Отключить VPN');
    assert.equal(find(menu, 'quick-vpn-toggle').enabled, group !== 'vpn');
    assert.equal(find(menu, 'quick-zapret-toggle').enabled, group !== 'zapret');
    assert.equal(find(menu, 'quick-zapret-batch:0').enabled, group !== 'zapret');
    assert.equal(find(menu, 'quick-music-next').enabled, group !== 'music');
    assert.equal(find(menu, 'quick-rest').enabled, group !== 'pet');
  }
});

test('independent quick actions run concurrently while duplicate operations stay blocked', async () => {
  const { EventEmitter } = require('node:events');
  const handlers = new Map(), calls = [];
  let win, releaseZapret, releaseVpn;
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.webContents = Object.assign(new EventEmitter(), { send() {}, setWindowOpenHandler() {} }); win = this; }
    setAlwaysOnTop() {} loadURL() {} isDestroyed() { return false; } isVisible() { return true; } destroy() {} hide() {}
    setResizable(value) { this.resizable = value; } getBounds() { return { ...this.options }; } setBounds(bounds) { Object.assign(this.options, bounds); }
  }
  const menu = createQuickMenu({
    BrowserWindow: Window, ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    screen: { getCursorScreenPoint: () => ({ x: 300, y: 200 }), getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
    getVpn: () => ({ state: () => ({ ...vpn, phase: 'disconnected' }), start: () => { calls.push('vpn'); return new Promise((resolve) => { releaseVpn = resolve; }); } }),
    getZapret: () => ({ state: () => ({ phase: 'stopped', supported: true, batches: [] }), start: () => { calls.push('zapret'); return new Promise((resolve) => { releaseZapret = resolve; }); } }),
    getPetState: () => pet, getMusicState: () => ({ ready: true }), open() {}, pin() {}, rest: () => calls.push('rest'),
    musicToggle() {}, musicPrevious() {}, musicNext: () => calls.push('next'), musicVolume() {}, onError: (error) => { throw error; },
  });
  menu.show();
  assert.equal(win.options.height, 575); assert.ok(win.options.y + win.options.height <= 1080);
  const event = { sender: win.webContents }, state = () => handlers.get('quick:state')(event);
  const action = (id) => handlers.get('quick:action')(event, id);
  const zapret = action('quick-zapret-toggle');
  assert.equal(find(state().items, 'quick-vpn-toggle').label, 'Подключить VPN');
  assert.equal(find(state().items, 'quick-vpn-toggle').enabled, true);
  await assert.rejects(action('quick-zapret-toggle'), /недоступно/);
  const connecting = action('quick-vpn-toggle');
  assert.equal(find(state().items, 'quick-vpn-toggle').enabled, false);
  await action('quick-music-next'); await action('quick-rest');
  assert.deepEqual(calls, ['zapret', 'vpn', 'next', 'rest']);
  releaseZapret(); await zapret;
  assert.equal(find(state().items, 'quick-zapret-toggle').enabled, true);
  assert.equal(find(state().items, 'quick-vpn-toggle').enabled, false);
  releaseVpn(); await connecting;
  assert.equal(find(state().items, 'quick-vpn-toggle').enabled, true);
  const fit = handlers.get('quick:fit');
  for (const invalid of [NaN, Infinity, -1, 0, 5000, '500', {}]) assert.throws(() => fit(event, invalid), /размер/);
  assert.throws(() => fit({ sender: {} }, 500), /sender/);
  fit(event, 2500); assert.equal(win.options.height, 1080); assert.equal(win.options.y, 0);
  fit(event, 420); assert.equal(win.options.height, 420); assert.equal(win.resizable, false);
  assert.equal(Object.hasOwn(state(), 'error'), false);
  menu.close();
});
test('music is a direct action followed by transport and a bounded volume control', () => {
  const menu = quickTemplate({ vpn, pet, music: { ready: true, playing: false, volume: .35 } }, {});
  assert.equal(find(menu, 'quick-music-open').label, 'Музыка');
  assert.equal(find(menu, 'quick-music-open').submenu, undefined);
  assert.ok(find(menu, 'quick-music-prev')); assert.ok(find(menu, 'quick-music-next'));
  assert.equal(find(menu, 'quick-volume').value, .35);
});
