// Generated NOIR drawings registered to the existing 240x420 sprite coordinates.
export const NOIR_POSES = {
  seated: { file: 'seated.png', scale: 232 / 915, anchorX: 510, offsetY: 0 },
  sleepSeated: { file: 'sleep-lying.png', scale: 220 / 1536, anchorX: 768, offsetY: 232 - 822 * 220 / 1536 },
  sleepLying: { file: 'sleep-lying.png', scale: 220 / 1536, anchorX: 768, offsetY: 418 - 822 * 220 / 1536 },
  gazeSeated: { file: 'gaze-seated.png', scale: 232 / 915, anchorX: 510, offsetY: 0 },
  musicSeated: { file: 'music-seated.png', scale: 232 / 915, anchorX: 510, offsetY: 0 },
  thinking: { file: 'thinking.png', scale: 418 / 1659, anchorX: 480, offsetY: 0 },
  wave: { file: 'wave.png', scale: 418 / 1659, anchorX: 500, offsetY: 0 },
};
export async function loadPoseArt(skin, loadImage) {
  if (skin !== 'mono') return {};
  const entries = await Promise.all(Object.entries(NOIR_POSES).map(async ([name, art]) => {
    const image = await loadImage('../../assets/skins/mono/poses/' + art.file);
    const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 420;
    canvas.getContext('2d').drawImage(image, 128 - art.anchorX * art.scale, art.offsetY, image.naturalWidth * art.scale, image.naturalHeight * art.scale);
    return [name, canvas];
  }));
  return Object.fromEntries(entries);
}
const SEATED_ACTS = new Set(['talk', 'look', 'curious', 'plop', 'split', 'gaze', 'uplink']);
export function choosePoseArt({ stance, mode, act = null, pointing = false, dragging = false, hidden = false, busy = false, musicPlaying = false }) {
  if (hidden || dragging || pointing || busy || !['stand', 'sit'].includes(stance)) return null;
  if (stance === 'sit') {
    if (act && !SEATED_ACTS.has(act)) return null;
    if (mode === 'sleep') return 'sleepSeated';
    if (act === 'gaze' || act === 'uplink') return 'gazeSeated';
    return musicPlaying && mode === 'idle' ? 'musicSeated' : 'seated';
  }
  if (mode === 'sleep') return 'sleepLying';
  if (act === 'victory' || act === 'wave') return 'wave';
  if (mode === 'alert' && (!act || ['talk', 'look', 'curious'].includes(act))) return 'thinking';
  return null;
}
