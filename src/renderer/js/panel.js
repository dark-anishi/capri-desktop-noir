// The transmission panel next to Capri, and the one-line ticker she wears while Codex works.

import { clamp, reducedMotion } from './util.js';

const NOISE = '▚▞▙▟░▒#%&/\\<>01XZ';

// Her faces, frames of her from the show (tools/build-cutins.py). A message can ask for one;
// otherwise it goes with what kind of message it is.
const FACE_DIR = '../../assets/capri/';
export const FACES = {
  calm: 'face-calm.png',   // watching, mouth shut
  aside: 'face-aside.png', // turned away: a sigh, thinking
  smug: 'face-smug.png',   // the fang grin, head cocked
  wide: 'face-wide.png',   // eyes gone round: surprised
  look: 'face-look.png',   // looking right at you
  laugh: 'face-laugh.png', // mouth wide open
  many: 'face-many.png',   // all her eyes on you
  grin: 'capri-face.png',
};
const KIND_FACE = { alert: 'many', done: 'look', error: 'laugh', work: 'calm', idle: 'calm' };
const PRIORITY = { info: 1, idle: 1, work: 2, done: 3, error: 3, alert: 4 };
const DECODE_STEP_MS = 28;

export class Panel {
  constructor({ panel, ticker, labels }) {
    this.el = panel;
    this.tickerEl = ticker;
    this.labels = labels;
    this.line = panel.querySelector('.panel__line');
    this.portrait = panel.querySelector('.panel__face img');
    this.quote = panel.querySelector('.panel__quote');
    this.reply = panel.querySelector('.panel__reply');
    this.actions = panel.querySelector('.panel__actions');
    this.onAction = null; // (id) => void, a button of the message was clicked
    this.onDismiss = null; // (message) => void, a message left: closed, timed out or replaced
    this.summary = panel.querySelector('.panel__summary');
    this.log = panel.querySelector('.panel__log');
    this.tag = panel.querySelector('.panel__tag');
    this.state = panel.querySelector('.panel__state');
    this.tickerVerb = ticker.querySelector('.ticker__verb');
    this.tickerTarget = ticker.querySelector('.ticker__target');
    this.current = null;
    this.hideTimer = null;
    this.decodeTimer = null;
    this.anchor = { x: 0, y: 0, side: 1 };
    this.view = { w: innerWidth, h: innerHeight };
    this.onChar = null;    // (mood) => void, for the voice blips
    this.onTalk = null;    // (talking: boolean) => void
    this.suspended = false;
    this.quiet = false;
    this.tickerAction = null;
    this.tickerShownAt = 0;
    this.tickerTimer = null;

    this.el.addEventListener('click', () => this.hide());
    this.portrait.addEventListener('animationend', (e) => {
      if (e.animationName === 'face-swap') this.portrait.classList.remove('is-swapping');
    });
  }

  get visible() {
    return !this.quiet && !this.el.hidden && !this.suspended && !this.leaving;
  }

  // Message: { kind, line, tag, quote, reply, summary, log: [{verb, target, error}], actions, guide,
  //            hold (ms | null for sticky) }
  // reply: Codex's whole answer, in a block that scrolls
  // actions: buttons, [{ id, label, primary }]; clicking one calls onAction(id)
  // guide: the quote is an explanation, shown whole
  // badge: the word in the corner, instead of the one for its kind
  // face: her expression (a key of FACES), instead of the one for its kind
  say(msg) {
    if (this.quiet) {
      // Keep only a still-pending question; routine/game-time chatter is dropped.
      if (msg.kind === 'alert') this.current = { ...msg, at: performance.now() };
      return false;
    }
    const cur = this.current;
    if (cur && this.visible && cur.kind !== msg.kind && PRIORITY[cur.kind] > PRIORITY[msg.kind] && performance.now() - cur.at < 2600) {
      return false; // don't step on something more important that just appeared
    }
    if (cur?.reply && this.visible && PRIORITY[msg.kind] < 2) return false; // nor on an answer you may be reading
    if (cur && this.visible) this.onDismiss?.(cur);
    this.current = { ...msg, at: performance.now() };
    clearTimeout(this.hideTimer);

    this.el.dataset.kind = msg.kind;
    this.setFace(msg.face || KIND_FACE[msg.kind] || 'grin');
    this.tag.textContent = msg.tag || '';
    this.state.textContent = msg.badge || this.labels.state[msg.kind] || '';
    this.quote.textContent = msg.quote || '';
    this.quote.hidden = !msg.quote;
    this.reply.textContent = msg.reply || '';
    this.reply.hidden = !msg.reply;
    this.reply.scrollTop = 0;
    this.el.classList.toggle('has-reply', Boolean(msg.reply));
    this.el.classList.toggle('is-guide', Boolean(msg.guide));
    this.actions.replaceChildren(...(msg.actions || []).map(({ id, label, primary }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = primary ? 'panel__action is-primary' : 'panel__action';
      button.textContent = label;
      button.addEventListener('click', (e) => {
        e.stopPropagation(); // a click on the panel itself closes it
        this.onAction?.(id);
      });
      return button;
    }));
    this.actions.hidden = !msg.actions?.length;
    this.summary.textContent = msg.summary || '';
    this.summary.hidden = !msg.summary;
    this.renderLog(msg.log || []);

    this.tickerEl.hidden = true;
    this.leaving = false;
    this.el.hidden = false;
    this.el.classList.remove('is-leaving');
    this.replayEnter();
    this.place();
    this.decode(msg.line || '', msg.kind);

    if (msg.hold) this.hideTimer = setTimeout(() => this.hide(), msg.hold);
    return true;
  }

  // Change her expression; the swap glitches across a couple of drawings.
  setFace(name) {
    const file = FACES[name] || FACES.grin;
    const src = this.skin === 'mono' ? '../../assets/skins/mono/' + file.replace('.png', '.svg') : FACE_DIR + file;
    if (this.portrait.getAttribute('src') === src) return;
    this.portrait.setAttribute('src', src);
    if (reducedMotion.matches) return;
    this.portrait.classList.remove('is-swapping');
    void this.portrait.offsetWidth; // restart the animation
    this.portrait.classList.add('is-swapping');
  }

  // Refresh the log of the message on screen without re-announcing it.
  updateLog(log) {
    if (this.current && this.visible) this.renderLog(log);
  }

  renderLog(entries) {
    this.log.replaceChildren(...entries.slice(-4).map((e) => {
      const li = document.createElement('li');
      if (e.error) li.className = 'is-error';
      const verb = document.createElement('span');
      verb.className = 'panel__verb';
      verb.textContent = e.verb;
      const target = document.createElement('span');
      target.className = 'panel__target';
      target.textContent = e.target || '';
      li.append(verb, target);
      return li;
    }));
    this.log.hidden = entries.length === 0;
  }

  hide() {
    clearTimeout(this.hideTimer);
    clearInterval(this.decodeTimer);
    this.onTalk?.(false);
    if (this.el.hidden || this.leaving) return;
    const gone = this.current;
    this.current = null;
    this.leaving = true;
    if (gone) this.onDismiss?.(gone);
    if (reducedMotion.matches) {
      this.el.hidden = true;
    } else {
      this.el.classList.add('is-leaving');
      setTimeout(() => {
        if (this.leaving) this.el.hidden = true;
      }, 150);
    }
    // back to the ticker if Codex is still busy
    if (this.tickerAction) this.setTicker(this.tickerAction);
  }

  // Only drop a sticky alert (permission prompt) once it has been dealt with.
  clearKind(kind) {
    if (this.current?.kind === kind) {
      if (this.quiet) this.current = null;
      else this.hide();
    }
  }

  setQuiet(on) {
    on = Boolean(on);
    if (on === this.quiet) return;
    const pending = this.current?.kind === 'alert' ? this.current : null;
    this.quiet = on;
    clearTimeout(this.hideTimer); clearInterval(this.decodeTimer);
    this.onTalk?.(false);
    this.current = pending; this.leaving = false; this.el.hidden = true;
    if (on) this.suspend();
    else {
      this.current = null; this.resume();
      if (pending) this.say({ ...pending, silent: true });
      else this.setTicker(this.tickerAction);
    }
  }

  suspend() {
    this.suspended = true;
    this.el.style.visibility = 'hidden';
    this.tickerEl.style.visibility = 'hidden';
  }

  resume() {
    if (this.quiet) return;
    this.suspended = false;
    this.el.style.visibility = '';
    this.tickerEl.style.visibility = '';
    this.place();
    if (!this.el.hidden) this.replayEnter();
  }

  replayEnter() {
    this.el.classList.remove('is-entering');
    void this.el.offsetWidth; // restart the CSS animation
    this.el.classList.add('is-entering');
  }

  decode(text, kind) {
    clearInterval(this.decodeTimer);
    if (reducedMotion.matches || !text) {
      this.line.textContent = text;
      return;
    }
    const chars = [...text];
    let done = 0;
    this.onTalk?.(true);
    const step = () => {
      done = Math.min(chars.length, done + 2);
      const head = chars.slice(0, done).join('');
      let tail = '';
      for (let i = done; i < Math.min(chars.length, done + 6); i++) {
        tail += chars[i] === ' ' ? ' ' : NOISE[Math.floor(Math.random() * NOISE.length)];
      }
      this.line.textContent = head + tail;
      if (chars[done - 1] && chars[done - 1] !== ' ') this.onChar?.(kind);
      if (done >= chars.length) {
        clearInterval(this.decodeTimer);
        this.line.textContent = text;
        this.onTalk?.(false);
      }
    };
    step();
    this.decodeTimer = setInterval(step, DECODE_STEP_MS);
  }

  // Ticker: "▸ Modifie  main.js" floating over her head while Codex works.
  // Throttled so a burst of tool calls reads as a flicker of activity, not noise.
  setTicker(action) {
    this.tickerAction = action;
    clearTimeout(this.tickerTimer);
    if (!action || this.visible) {
      this.tickerEl.hidden = true;
      return;
    }
    const wait = Math.max(0, 380 - (performance.now() - this.tickerShownAt));
    this.tickerTimer = setTimeout(() => {
      this.tickerShownAt = performance.now();
      this.tickerVerb.textContent = action.verb;
      this.tickerTarget.textContent = action.target || '';
      this.tickerEl.dataset.error = action.error ? 'true' : 'false';
      this.tickerEl.hidden = false;
      this.tickerEl.classList.remove('is-flash');
      void this.tickerEl.offsetWidth;
      this.tickerEl.classList.add('is-flash');
      this.place();
    }, wait);
  }

  setAnchor(anchor, view) {
    this.anchor = anchor;
    this.view = view;
    this.place();
  }

  // Sit on the tips of her mane, leaning toward the middle of the screen; tail points at her.
  place() {
    const { x, y, top: crown = y - 80, lean = 0, seated = false, body } = this.anchor;
    const { w } = this.view;
    const margin = 14;
    // lean: the side she wants it on (away from what she's pointing at), else toward the middle
    const towardLeft = lean ? lean < 0 : x > w / 2;

    if (!this.el.hidden) {
      const pw = this.el.offsetWidth;
      const ph = this.el.offsetHeight;
      let left = towardLeft ? x - pw + 46 : x - 46;
      left = clamp(left, margin, w - pw - margin);
      let top = crown - ph + 14;
      let below = false;
      if (top < margin) {
        top = y + 40;
        below = true;
      }
      let side = '';
      if (seated && body) {
        const gap = 24;
        const roomLeft = body.left - margin, roomRight = w - margin - body.right;
        const useLeft = roomLeft >= pw + gap ? (towardLeft || roomRight < pw + gap) : roomRight < pw + gap && roomLeft > roomRight;
        left = useLeft ? body.left - gap - pw : body.right + gap;
        left = clamp(left, margin, Math.max(margin, w - pw - margin));
        top = y - ph / 2;
        below = false;
        side = useLeft ? 'left' : 'right';
      }
      if (this.view.h) top = clamp(top, margin, this.view.h - ph - margin); // a tall one (an answer) stays on screen
      this.el.dataset.side = side;
      this.el.style.setProperty('--tail-y', `${clamp(y - top, 18, ph - 18)}px`);
      this.el.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
      this.el.style.setProperty('--tail-x', `${clamp(x - left, 24, pw - 24)}px`);
      this.el.dataset.below = below ? 'true' : 'false';
    }

    if (!this.tickerEl.hidden) {
      const tw = this.tickerEl.offsetWidth;
      const left = clamp(x - tw / 2, margin, w - tw - margin);
      const top = Math.max(margin, crown - this.tickerEl.offsetHeight - 10);
      this.tickerEl.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
    }
  }

  rect() {
    if (this.el.hidden || this.suspended) return null;
    return this.el.getBoundingClientRect();
  }
}
