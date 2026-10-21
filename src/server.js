'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { candidatePaths, pickDefault, readConfig, writeConfig } = require('./config');
const { discover, testModel, getSchema } = require('./discover');
const { listFiles, readFile, writeFile, createFile, removeFile } = require('./files');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

function createServer({ configPath, cwd = process.cwd() }) {
  const token = crypto.randomBytes(16).toString('hex');
  const state = { target: configPath ? path.resolve(configPath) : pickDefault(candidatePaths(cwd)) };

  const send = (res, status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  };

  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > 10 * 1024 * 1024) reject(new Error('Body too large'));
        else chunks.push(c);
      });
      req.on('end', () => {
        try {
          resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
        } catch (e) {
          reject(e);
        }
      });
      req.on('error', reject);
    });

  const stateResponse = () => {
    const candidates = candidatePaths(cwd);
    if (!candidates.some((c) => c.path === state.target)) candidates.unshift({ path: state.target, scope: 'custom', exists: fs.existsSync(state.target) });
    return { ...readConfig(state.target), candidates };
  };

  const routes = {
    'GET /api/state': async () => stateResponse(),
    'POST /api/target': async (body) => {
      if (!body.path || !/\.jsonc?$/i.test(body.path)) throw new Error('Config path must end with .json or .jsonc');
      state.target = path.resolve(body.path);
      return stateResponse();
    },
    'POST /api/save': async (body) => {
      if (!body.config || typeof body.config !== 'object' || Array.isArray(body.config)) throw new Error('config must be an object');
      const r = writeConfig(state.target, body.config);
      return { ...stateResponse(), backup: r.backup };
    },
    'POST /api/discover': async (body) => discover(body),
    'POST /api/test': async (body) => testModel(body),
    'GET /api/schema': async () => getSchema(),
    'GET /api/files': async () => listFiles(cwd),
    'POST /api/file/read': async (body) => readFile(String(body.path || ''), cwd),
    'POST /api/file/write': async (body) => writeFile(String(body.path || ''), body.content, cwd),
    'POST /api/file/create': async (body) => createFile(String(body.group || ''), String(body.name || '').trim(), cwd),
    'POST /api/file/delete': async (body) => removeFile(String(body.path || ''), cwd),
  };

  const server = http.createServer(async (req, res) => {
    // Only answer to localhost names (blocks DNS-rebinding attacks).
    const host = (req.headers.host || '').replace(/:\d+$/, '');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname.startsWith('/api/')) {
      if (req.headers['x-token'] !== token) return send(res, 401, { error: 'Invalid session token. Reopen the URL printed in the terminal.' });
      const handler = routes[`${req.method} ${url.pathname}`];
      if (!handler) return send(res, 404, { error: 'Not found' });
      try {
        const body = req.method === 'POST' ? await readBody(req) : {};
        return send(res, 200, await handler(body));
      } catch (e) {
        return send(res, 400, { error: e.message, attempts: e.attempts });
      }
    }

    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.join(PUBLIC_DIR, path.normalize(rel));
    if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });

  return { server, token, state };
}

module.exports = { createServer };
