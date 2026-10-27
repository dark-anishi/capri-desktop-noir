'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { test } = require('node:test');
const hooks = require('./install-hooks');

test('installation is repeatable, preserves other hooks, and refuses invalid JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-codex-'));
  const previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = dir;
  try {
    const file = path.join(dir, 'hooks.json');
    const original = { description: 'User hooks', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo user' }] }] } };
    fs.writeFileSync(file, JSON.stringify(original));
    hooks.install();
    const installed = fs.readFileSync(file, 'utf8');
    assert.equal(hooks.status().installed, true);
    assert.equal(hooks.status().file, file);
    const parsed = JSON.parse(installed);
    assert.equal(parsed.hooks.Interrupt[0].hooks[0].timeout, 3);
    assert.equal(parsed.hooks.SessionEnd[0].hooks[0].async, false);
    assert.equal(parsed.hooks.Notification, undefined);
    hooks.install();
    assert.equal(fs.readFileSync(file, 'utf8'), installed);
    // Another handler sharing a Capri group must survive removal.
    parsed.hooks.SessionStart[0].hooks.push({ type: 'command', command: 'echo shared' });
    fs.writeFileSync(file, JSON.stringify(parsed));
    hooks.uninstall();
    const remaining = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(remaining.hooks.Stop, original.hooks.Stop);
    assert.equal(remaining.hooks.SessionStart[0].hooks[0].command, 'echo shared');
    assert.equal(hooks.status().installed, false);
    for (const invalid of ['{broken', 'null', '[]', '{"hooks":{"Stop":{}}}']) {
      fs.writeFileSync(file, invalid);
      assert.throws(() => hooks.install());
      assert.equal(fs.readFileSync(file, 'utf8'), invalid);
    }
  } finally {
    if (previous === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Codex hooks forward approvals, failures, patch paths and final answers', async () => {
  const events = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (part) => { body += part; });
    req.on('end', () => { events.push(JSON.parse(body)); res.end('{}'); });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  async function run(event) {
    const child = spawn(process.execPath, [path.join(__dirname, '../hooks/capri-hook.js')], {
      env: { ...process.env, CAPRI_PORT: String(server.address().port) }, windowsHide: true,
    });
    let stdout = '';
    child.stdout.on('data', (data) => { stdout += data; });
    const closed = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
    child.stdin.end(JSON.stringify({ session_id: 'test', ...event }));
    assert.equal(await closed, 0);
    return stdout;
  }
  try {
    await run({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { description: 'Allow command?' } });
    assert.equal(events.at(-1).notification_type, 'permission_prompt');
    for (const tool_name of ['request_user_input', 'functions.request_user_input_async']) {
      await run({ hook_event_name: 'PreToolUse', tool_name, tool_use_id: 'question-1', tool_input: { questions: [{ question: 'Which category?', options: [{ label: 'Games', description: 'private description' }] }, { title: 'Choose a folder', options: ['Desktop', 'Documents'] }] } });
      const question = events.at(-1);
      assert.equal(question.hook_event_name, 'Notification');
      assert.equal(question.notification_type, 'agent_needs_input');
      assert.equal(question.question_id, 'question-1');
      assert.equal(question.message, 'Which category?\nGames\n\nChoose a folder\nDesktop / Documents');
      assert.equal(question.tool_input, undefined);
      await run({ hook_event_name: 'PostToolUse', tool_name, tool_use_id: 'question-1' });
      assert.equal(events.at(-1).hook_event_name, tool_name.endsWith('_async') ? 'CapriQuestionPending' : 'CapriQuestionAnswered');
      for (const failure of [{ hook_event_name: 'PostToolUse', tool_response: { isError: true, error: 'Cancelled' } }, { hook_event_name: 'PostToolUse', tool_response: { exit_code: 1 } }, { hook_event_name: 'PostToolUseFailure' }]) {
        await run({ tool_name, tool_use_id: 'question-1', ...failure });
        assert.equal(events.at(-1).hook_event_name, 'PostToolUseFailure');
        assert.equal(events.at(-1).question_id, 'question-1');
      }
    }
    await run({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_response: { exit_code: 1, output: 'Failed' } });
    assert.equal(events.at(-1).hook_event_name, 'PostToolUseFailure');
    await run({ hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Update File: src/app.js\nprivate contents' } });
    assert.deepEqual(events.at(-1).tool_input, { files: ['src/app.js'] });
    assert.equal(await run({ hook_event_name: 'Stop', last_assistant_message: 'Done' }), '{}\n');
    assert.equal(events.at(-1).last_assistant_message, 'Done');
    assert.equal(await run({ hook_event_name: 'SubagentStop' }), '{}\n');
    await run({ hook_event_name: 'Interrupt' });
    assert.equal(events.at(-1).hook_event_name, 'Interrupt');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
