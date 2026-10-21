#!/usr/bin/env node
'use strict';

// End-to-end check: start the server on a temp config, discover models from a
// public endpoint, save a provider, and verify the written file.

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { createServer } = require('../src/server');
const { parseJsonc } = require('../src/jsonc');

async function main() {
  // JSONC parser
  const parsed = parseJsonc('{\n // c\n "a": "http://x//y", /* b */ "b": [1,2,],\n}');
  assert.deepStrictEqual(parsed, { a: 'http://x//y', b: [1, 2] });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocjm-'));
  const file = path.join(dir, 'opencode.json');
  fs.writeFileSync(file, JSON.stringify({ $schema: 'https://opencode.ai/config.json', theme: 'x' }));

  process.env.XDG_CONFIG_HOME = path.join(dir, 'xdg');
  const { server, token } = createServer({ configPath: file, cwd: dir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://localhost:${server.address().port}`;
  const call = async (method, p, body) => {
    const res = await fetch(base + p, { method, headers: { 'X-Token': token, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: res.status, json: await res.json() };
  };

  try {
    assert.strictEqual((await fetch(base + '/api/state')).status, 401, 'token required');
    const st = await call('GET', '/api/state');
    assert.strictEqual(st.json.config.theme, 'x');

    const d = await call('POST', '/api/discover', { baseURL: 'https://openrouter.ai/api/v1/models' });
    assert.strictEqual(d.status, 200, JSON.stringify(d.json));
    assert.ok(d.json.models.length > 10, 'models discovered');
    const m = d.json.models.find((x) => x.recommended && x.suggestion.limit);
    assert.ok(m, 'has a recommended model with limits');
    console.log(`discovered ${d.json.models.length} models; sample ${m.id}`);

    const cfg = { ...st.json.config, provider: { openrouter: { npm: d.json.hint.npm, options: { baseURL: d.json.baseURL }, models: { [m.id]: m.suggestion } } } };
    const sv = await call('POST', '/api/save', { config: cfg });
    assert.strictEqual(sv.status, 200);
    const written = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.ok(written.provider.openrouter.models[m.id]);
    assert.ok(fs.existsSync(file + '.bak'), 'backup created');

    // Rules / agents / ignore files (global dir redirected to the temp folder).
    const files = await call('GET', '/api/files');
    assert.strictEqual(files.status, 200);
    const agentsMd = files.json.groups.find((g) => g.id === 'global-rules').files[0];
    assert.strictEqual(agentsMd.path, path.join(dir, 'xdg', 'opencode', 'AGENTS.md'));
    assert.strictEqual((await call('POST', '/api/file/write', { path: agentsMd.path, content: '# Rules\n' })).status, 200);
    assert.strictEqual(fs.readFileSync(agentsMd.path, 'utf8'), '# Rules\n');
    const created = await call('POST', '/api/file/create', { group: 'global-agents', name: 'review' });
    assert.strictEqual(created.status, 200, JSON.stringify(created.json));
    assert.ok(fs.existsSync(path.join(dir, 'xdg', 'opencode', 'agents', 'review.md')));
    assert.strictEqual((await call('POST', '/api/file/read', { path: path.join(dir, 'secret.txt') })).status, 400, 'unlisted files are refused');
    assert.strictEqual((await call('POST', '/api/file/create', { group: 'global-agents', name: '../x' })).status, 400, 'no path tricks');
    await call('POST', '/api/file/delete', { path: created.json.path });
    assert.ok(fs.existsSync(created.json.path + '.bak') && !fs.existsSync(created.json.path), 'delete keeps a .bak');

    const schema = await call('GET', '/api/schema');
    assert.ok(schema.json.schema?.properties, 'schema available');
    console.log(`schema source: ${schema.json.source}`);
    console.log('smoke test passed');
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
