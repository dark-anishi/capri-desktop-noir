'use strict';

// Foreground metadata stays in main; no titles, paths or process list reach the renderer.
const GAME_EXECUTABLES = /^(?:robloxplayerbeta|dota2|cs2|csgo|cyberpunk2077|bg3(?:_dx11)?|aces|warthunder|bf6|bf2042|bfv|bf1|project8|deadlock|root|rimworldwin64|under dogs|underdogs|minecraft\.windows|fortniteclient-win64-shipping|valorant-win64-shipping|r5apex|overwatch|gta5(?:_enhanced)?|eldenring|witcher3)\.exe$/i;
function isGameActivity(activity) {
  if (!activity || activity.own === true) return false;
  if (activity.fullscreen === true || activity.exclusive === true || activity.gamePath === true) return true;
  const executable = typeof activity.executable === 'string' ? activity.executable : '';
  if (GAME_EXECUTABLES.test(executable)) return true;
  if (/^(?:UnityWndClass|UnrealWindow)$/.test(activity.windowClass || '') && !/^(?:Unity|UnrealEditor|UE4Editor)(?:-.*)?\.exe$/i.test(executable)) return true;
  return /^(?:java|javaw)\.exe$/i.test(executable) && /^(?:GLFW30|LWJGL)$/.test(activity.windowClass || '');
}

function sameDisplay(first, second) {
  if (!second) return true; // Compatibility with an older watcher snapshot.
  return Math.min(first.x + first.width, second.x + second.width) > Math.max(first.x, second.x) && Math.min(first.y + first.height, second.y + second.height) > Math.max(first.y, second.y);
}
function createGameMode({ overlay, onChange = () => {}, hideQuick = () => {} }) {
  let active = false, playing = false, covered = true, revealed = false, previousMuted = overlay.webContents.isAudioMuted();
  const alive = () => !overlay.isDestroyed() && !overlay.webContents.isDestroyed();
  function sync() {
    if (!alive()) return;
    overlay.webContents.setAudioMuted(playing ? true : previousMuted);
    if (active) {
      overlay.setIgnoreMouseEvents(true, { forward: true });
      overlay.hide(); hideQuick();
    }
    onChange(active, playing);
  }
  return {
    get active() { return active; },
    get quiet() { return playing; },
    sync,
    toggleReveal() {
      if (!playing || !covered || !alive()) return false;
      revealed = !revealed; active = !revealed;
      sync(); if (!active) overlay.showInactive();
      return true;
    },
    update(value, options = {}) {
      const next = value === true;
      const nextCovered = options.covered !== false;
      if ((next === playing && nextCovered === covered) || !alive()) return;
      if (next && !playing) previousMuted = overlay.webContents.isAudioMuted();
      if (!next) revealed = false;
      const wasActive = active;
      playing = next; covered = nextCovered;
      active = playing && covered && !revealed;
      sync();
      if (wasActive && !active) overlay.showInactive();
    },
  };
}
module.exports = { isGameActivity, createGameMode, sameDisplay };
