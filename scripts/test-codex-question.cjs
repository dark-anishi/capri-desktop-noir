'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const base = path.join(__dirname, '../src/renderer/js');
const uri = (text) => 'data:text/javascript;base64,' + Buffer.from(text).toString('base64');
async function BrainClass() {
  const source = fs.readFileSync(path.join(base, 'brain.js'), 'utf8').replaceAll("'./lines.js'", JSON.stringify(uri(fs.readFileSync(path.join(base, 'lines.js'), 'utf8')))).replaceAll("'./util.js'", JSON.stringify(uri(fs.readFileSync(path.join(base, 'util.js'), 'utf8'))));
  const previous = global.matchMedia;
  global.matchMedia = () => ({ matches: false });
  try { return (await import(uri(source))).Brain; }
  finally { if (previous === undefined) delete global.matchMedia; else global.matchMedia = previous; }
}
test('a question stays visible during independent work and clears only on answer', async () => {
  const Brain = await BrainClass(), messages = [];
  const capri = { mode: 'idle', windows: { wins: [] }, wake() {}, attend() {}, hurt() {}, setMode(mode) { this.mode = mode; }, towardCenter: () => 1, perform() {}, stopPointing() {} };
  const panel = { say: (message) => messages.push(message), clearKind: () => messages.push('clear'), setTicker() {} };
  const brain = new Brain({ capri, panel, voice: { play() {} }, host: { cursor: async () => null }, lang: 'ru' });
  const event = { session_id: 'questions', hook_event_name: 'Notification', notification_type: 'agent_needs_input', question_id: 'q1', message: 'Какую папку?' };
  await brain.handle(event);
  assert.equal(capri.mode, 'alert'); assert.equal(messages.at(-1).quote, event.message); assert.match(messages.at(-1).line, /вопрос|ответ|уточнить/);
  const count = messages.length;
  for (const name of ['PreToolUse', 'PostToolUse', 'CapriQuestionPending', 'Stop']) brain.handle({ ...event, hook_event_name: name });
  assert.equal(messages.length, count); assert.equal(brain.sessions.get('questions').waiting, true);
  await brain.handle({ ...event, question_id: 'q2' });
  brain.handle({ ...event, hook_event_name: 'CapriQuestionAnswered' });
  assert.equal(brain.sessions.get('questions').waiting, true);
  brain.handle({ ...event, hook_event_name: 'CapriQuestionAnswered', question_id: 'q2' });
  assert.equal(brain.sessions.get('questions').waiting, false); assert.equal(capri.mode, 'idle');
  await brain.handle(event);
  brain.handle({ session_id: 'questions', hook_event_name: 'PostToolUseFailure', tool_name: 'functions.request_user_input_async', tool_use_id: 'q1', error: 'Cancelled' });
  assert.equal(brain.sessions.get('questions').waiting, false); assert.equal(brain.sessions.get('questions').questions.size, 0);
  assert.equal(messages.at(-1).kind, 'error');
});
