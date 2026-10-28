// Small, event-driven gestures. Dropped reactions are never queued for later.
export const REACTIONS = {
  launched: { act: 'acknowledge', cooldown: 12000, kind: 'info', face: 'smug' },
  launchError: { act: 'shrug', cooldown: 18000, kind: 'error', face: 'wide' },
  wake: { act: 'stretch', seatedAct: 'unwind', cooldown: 30000, kind: 'info', face: 'calm' },
  musicPaused: { act: 'settle', cooldown: 120000, kind: 'info', face: 'aside', silent: true },
};

export const REACTION_LINES = {
  ru: {
    launched: ['{app} на старте. Дальше твой ход.', 'Открываю {app}. Арсенал готов.', '{app} — принято. Поехали, чумба.', 'Передаю управление {app}.'],
    launchError: ['Этот ярлык упёрся. Загляни в его контекстное меню.', 'Дверь не открылась. Проверь, на месте ли приложение.', 'С запуском не сложилось. Ярлык всё ещё у меня.', 'Хм. Этот маршрут ведёт в тупик. Проверь ярлык.'],
    wake: ['Я здесь. Только поправлю пиксели.', 'Пара мгновений тишины — и снова в Сеть.', 'Размяла контуры. Что у нас дальше?', 'Проснулась. Ночной город сам себя не обойдёт.'],
    musicPaused: ['Пауза. Послушаем, как гудит Сеть.', 'Ритм подождёт. Я побуду рядом.', 'Оставим немного тишины.', 'Музыка на паузе. Мы никуда не спешим.'],
  },
  en: {
    launched: ['{app} is ready. Your move.', 'Opening {app}. Toolkit ready.'],
    launchError: ['That shortcut did not open. Check whether the app is still there.', 'No way through. Check the shortcut in its context menu.'],
    wake: ['Back online. Just stretching my pixels.', 'I’m here. What’s next?'],
    musicPaused: ['A pause. Let’s hear the Net hum.', 'The rhythm can wait. I’ll stay here.'],
  },
};

export class CompanionReactions {
  constructor({ capri, panel, language = () => 'ru', now = () => performance.now(), choose = lines => lines[Math.floor(Math.random() * lines.length)] }) {
    this.capri = capri; this.panel = panel; this.language = language; this.now = now; this.choose = choose;
    this.last = new Map(); this.lastAny = -Infinity;
    this.musicStartedAt = null;
  }

  react(name, details = {}) {
    const spec = REACTIONS[name], c = this.capri, now = this.now();
    if (!spec || c.gameQuiet || c.gameMode || c.manualRest || c.mode !== 'idle' || c.hidden || c.stowed || c.dormant || c.busy || c.dragging || c.pointing || c.pinOccluded || !['stand', 'sit'].includes(c.stance)) return false;
    if (c.act && c.act.player.priority > 0) return false;
    if (this.panel.visible && ['alert', 'work', 'done', 'error'].includes(this.panel.current?.kind)) return false;
    if (now - (this.last.get(name) ?? -Infinity) < spec.cooldown || now - this.lastAny < 5000) return false;
    const lang = this.language(), lines = REACTION_LINES[lang] || REACTION_LINES.en;
    const app = String(details.app || (lang === 'ru' ? 'приложение' : 'the app')).replace(/[\r\n\t]/g, ' ').slice(0, 80);
    const line = this.choose(lines[name]).replace('{app}', app);
    if (this.panel.say({ kind: spec.kind, line, face: spec.face, hold: 4300, silent: Boolean(spec.silent) }) === false) return false;
    this.last.set(name, now); this.lastAny = now;
    c.perform(c.stance === 'sit' && spec.seatedAct ? spec.seatedAct : spec.act);
    return true;
  }

  musicPlayback(playing) {
    if (playing) { this.musicStartedAt ??= this.now(); return false; }
    const started = this.musicStartedAt; this.musicStartedAt = null;
    // Ignore initial false events, buffering failures and momentary play/pause.
    return started !== null && this.now() - started >= 3000 ? this.react('musicPaused') : false;
  }
}
