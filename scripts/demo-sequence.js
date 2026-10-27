'use strict';

// A fake but realistic Codex session, used by `npm run demo` and the tray menu, then the
// showcase: everything she does on her own, one after the other (app.js). Each step:
// [delay before sending (ms), event].

const SESSION = 'demo-session';
const CWD = 'C:/Users/you/projects/night-city-api';

// demo: not a real Codex event (she doesn't count it as her first contact)
const base = (name, extra = {}) => ({ hook_event_name: name, session_id: SESSION, cwd: CWD, demo: true, ...extra });
const tool = (name, input) => base('PreToolUse', { tool_name: name, tool_input: input });
const done = (name, input, ms) => base('PostToolUse', { tool_name: name, tool_input: input, duration_ms: ms });

module.exports = [
  [0, base('SessionStart', { source: 'startup' })],
  [2600, base('UserPromptSubmit', { prompt: 'Ajoute un endpoint /gigs avec pagination et des tests' })],
  [1800, tool('Glob', { pattern: 'src/**/*.ts' })],
  [700, tool('Read', { file_path: `${CWD}/src/routes/index.ts` })],
  [900, tool('Read', { file_path: `${CWD}/src/db/gigs.ts` })],
  [1100, tool('Grep', { pattern: 'paginate' })],
  [900, tool('WebFetch', { url: 'https://docs.night.city/api/pagination' })],
  [1000, tool('Agent', { description: 'Vérifier les autres routes', subagent_type: 'Explore' })],
  [500, base('SubagentStart', { agent_type: 'Explore' })],
  [2400, base('SubagentStop', { agent_type: 'Explore' })],
  [1500, tool('Write', { file_path: `${CWD}/src/routes/gigs.ts`, content_len: 1840 })],
  [1300, tool('Edit', { file_path: `${CWD}/src/routes/index.ts`, old_string_len: 40, new_string_len: 92 })],
  [1200, tool('Bash', { command: 'npm test -- gigs', description: 'Lancer les tests des gigs' })],
  [2200, base('PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: 'npm test -- gigs' }, error: 'Exit code 1\nExpected 20 items, received 21' })],
  [1600, tool('Edit', { file_path: `${CWD}/src/routes/gigs.ts`, old_string_len: 12, new_string_len: 14 })],
  [1000, tool('Bash', { command: 'git push origin main', description: 'Pousser sur main' })],
  [700, base('Notification', { notification_type: 'permission_prompt', title: 'Permission needed', message: 'Codex needs your permission to use Bash' })],
  [5200, done('Bash', { command: 'npm test -- gigs' }, 3100)],
  [1500, base('Stop', { last_assistant_message: "J'ai ajouté **GET /gigs** avec une pagination par curseur, et 6 tests passent. Le push est fait." })],
  // not a Codex event: starts the showcase once the done panel has been read
  [9000, base('CapriShowcase')],
];
