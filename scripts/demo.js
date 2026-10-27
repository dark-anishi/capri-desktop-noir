#!/usr/bin/env node
'use strict';

// Plays the demo session against a running Capri, through the same HTTP bridge the hooks use.

const http = require('node:http');
const steps = require('./demo-sequence');

const PORT = Number(process.env.CAPRI_PORT) || 47823;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function post(evt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(evt);
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: '/event', method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, (res) => { res.resume(); res.on('end', resolve); });
    req.on('error', reject);
    req.end(body);
  });
}

(async () => {
  for (const [delay, evt] of steps) {
    await sleep(delay);
    process.stdout.write(`→ ${evt.hook_event_name}${evt.tool_name ? ' ' + evt.tool_name : ''}\n`);
    try {
      await post(evt);
    } catch {
      console.error(`Capri is not running (nothing on 127.0.0.1:${PORT}). Start it with: npm start`);
      process.exit(1);
    }
  }
})();
