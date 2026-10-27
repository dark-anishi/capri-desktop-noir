#!/usr/bin/env node
'use strict';

// Codex hook -> Capri.
// Reads the hook event on stdin and forwards a trimmed copy to the Capri app.
// Never block Codex. Only emit the empty JSON required by Stop/SubagentStop.

const http = require('node:http');

const PORT = Number(process.env.CAPRI_PORT) || 47823;

// Fields Capri actually uses. Everything else (file contents, tool output...) stays on your machine.
const KEEP = [
  'hook_event_name', 'session_id', 'cwd', 'session_title', 'permission_mode',
  'tool_name', 'tool_input', 'tool_use_id', 'duration_ms', 'error', 'is_interrupt',
  'prompt', 'message', 'title', 'notification_type', 'last_assistant_message',
  'agent_id', 'agent_type', 'source', 'reason', 'trigger', 'turn_id',
];

function trim(value, depth = 0) {
  if (typeof value === 'string') return value.length > 280 ? value.slice(0, 280) + '…' : value;
  if (Array.isArray(value)) return depth > 2 ? undefined : value.slice(0, 8).map((v) => trim(v, depth + 1));
  if (value && typeof value === 'object') {
    if (depth > 2) return undefined;
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      // big edit payloads are useless to Capri, keep only their size
      if (['content', 'old_string', 'new_string', 'new_source', 'edits'].includes(k)) {
        out[k + '_len'] = typeof v === 'string' ? v.length : Array.isArray(v) ? v.length : 0;
        continue;
      }
      out[k] = trim(v, depth + 1);
    }
    return out;
  }
  return value;
}

// Codex's answer, long enough for Capri to show it to you when you're not on Codex's window
const REPLY_MAX = 6000;

function slim(evt) {
  const out = {};
  for (const key of KEEP) if (evt[key] !== undefined) out[key] = trim(evt[key]);
  const reply = evt.last_assistant_message;
  if (typeof reply === 'string') out.last_assistant_message = reply.length > REPLY_MAX ? reply.slice(0, REPLY_MAX) + '…' : reply;
  if (evt.hook_event_name === 'PermissionRequest') {
    out.hook_event_name = 'Notification';
    out.notification_type = 'permission_prompt';
    out.message = trim(evt.tool_input?.description || evt.tool_input?.justification || evt.tool_name || '');
  }
  // Questions are local function tools, observed through Codex's documented
  // Pre/PostToolUse hooks. Notification is Capri's internal event, not an
  // unsupported Codex hook registration.
  const tool = String(evt.tool_name || '').split(/[.:]/).at(-1);
  if (['request_user_input', 'request_user_input_async'].includes(tool)) {
    const asyncQuestion = tool.endsWith('_async');
    if (evt.hook_event_name === 'PreToolUse') {
      let input = evt.tool_input;
      if (typeof input === 'string') { try { input = JSON.parse(input); } catch { input = {}; } }
      const questions = Array.isArray(input?.questions) ? input.questions : [];
      const text = questions.slice(0, 3).map((q) => {
        const title = typeof q?.question === 'string' ? q.question : typeof q?.title === 'string' ? q.title : '';
        const options = Array.isArray(q?.options) ? q.options.slice(0, 4).map((v) => typeof v === 'string' ? v : v?.label).filter((v) => typeof v === 'string') : [];
        return [title.slice(0, 500), options.join(' / ').slice(0, 300)].filter(Boolean).join('\n');
      }).filter(Boolean).join('\n\n');
      out.hook_event_name = 'Notification';
      out.notification_type = 'agent_needs_input';
      out.message = text.slice(0, 2000);
      out.question_id = String(evt.tool_use_id || evt.turn_id || 'question');
      out.question_async = asyncQuestion;
      delete out.tool_input;
    } else if (evt.hook_event_name === 'PostToolUse' || evt.hook_event_name === 'PostToolUseFailure') {
      out.hook_event_name = evt.hook_event_name === 'PostToolUseFailure' ? 'PostToolUseFailure' : asyncQuestion ? 'CapriQuestionPending' : 'CapriQuestionAnswered';
      out.question_id = String(evt.tool_use_id || evt.turn_id || 'question');
      delete out.tool_input;
    }
  }
  if (evt.hook_event_name === 'PostToolUse') {
    const response = evt.tool_response;
    const output = typeof response === 'string' ? response : response?.output;
    const exitCode = response?.exit_code ?? response?.exitCode;
    if (response?.isError || (typeof exitCode === 'number' && exitCode !== 0) || /(?:Process exited with code|Exit code)\s*:?\s*[1-9]\d*/i.test(output || '')) {
      out.hook_event_name = 'PostToolUseFailure';
      out.error = trim(output || response?.error || 'Tool failed');
    }
  }
  if (evt.tool_name === 'apply_patch') {
    out.tool_input = { files: [...String(evt.tool_input?.command || '').matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((m) => m[1]).slice(0, 100) };
  }
  return out;
}

let jsonOutput = false;
const bail = () => {
  if (jsonOutput) process.stdout.write('{}\n', () => process.exit(0));
  else process.exit(0);
};
setTimeout(bail, 2000).unref();

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  raw += chunk;
  if (raw.length > 8 * 1024 * 1024) bail();
});
process.stdin.on('error', bail);
process.stdin.on('end', () => {
  let evt;
  try {
    evt = JSON.parse(raw);
    if (!evt || typeof evt !== 'object' || typeof evt.hook_event_name !== 'string') return bail();
    jsonOutput = ['Stop', 'SubagentStop'].includes(evt.hook_event_name);
  } catch {
    return bail();
  }
  const body = JSON.stringify(slim(evt));
  const req = http.request({
    host: '127.0.0.1',
    port: PORT,
    path: '/event',
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    timeout: 800,
  }, (res) => {
    res.resume();
    res.on('end', bail);
  });
  req.on('timeout', () => { req.destroy(); bail(); });
  req.on('error', bail);
  req.end(body);
});
