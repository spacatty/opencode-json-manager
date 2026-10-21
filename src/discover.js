'use strict';

const fs = require('fs');
const path = require('path');

const MODELS_DEV_URL = 'https://models.dev/api.json';
const SCHEMA_URL = 'https://opencode.ai/config.json';
const BUNDLED_SCHEMA = path.join(__dirname, '..', 'schema', 'opencode-config.schema.json');

const cache = { modelsDev: null, modelsDevAt: 0, index: null, schema: null };

async function fetchJson(url, { headers = {}, timeout = 15000, method = 'GET', body } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      method,
      headers: { Accept: 'application/json', ...headers },
      body,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON */
    }
    return { ok: res.ok, status: res.status, json, text: text.slice(0, 2000) };
  } catch (e) {
    return { ok: false, status: 0, json: null, text: e.name === 'AbortError' ? 'Request timed out' : e.message };
  } finally {
    clearTimeout(t);
  }
}

// ---------- {env:VAR} / {file:path} resolution (same syntax OpenCode uses) ----------

function resolveValue(v) {
  if (typeof v !== 'string') return v;
  return v
    .replace(/\{env:([^}]+)\}/g, (_, name) => process.env[name.trim()] || '')
    .replace(/\{file:([^}]+)\}/g, (_, p) => {
      try {
        const file = p.trim().replace(/^~(?=$|[\\/])/, require('os').homedir());
        return fs.readFileSync(file, 'utf8').trim();
      } catch {
        return '';
      }
    });
}

function resolveHeaders(h) {
  const out = {};
  for (const [k, v] of Object.entries(h || {})) out[k] = resolveValue(v);
  return out;
}

// ---------- models.dev catalog ----------

async function getModelsDev() {
  const fresh = cache.modelsDev && Date.now() - cache.modelsDevAt < 60 * 60 * 1000;
  if (fresh) return cache.modelsDev;
  const r = await fetchJson(MODELS_DEV_URL, { timeout: 20000 });
  if (r.ok && r.json) {
    cache.modelsDev = r.json;
    cache.modelsDevAt = Date.now();
    cache.index = null;
  }
  return cache.modelsDev;
}

function normId(id) {
  return String(id)
    .toLowerCase()
    .replace(/:(free|beta|extended|thinking|nitro|floor|online)$/g, '')
    .replace(/[-_.](instruct|chat|latest)$/g, '')
    .replace(/[._]/g, '-');
}

function baseName(id) {
  const s = String(id);
  return normId(s.includes('/') ? s.slice(s.lastIndexOf('/') + 1) : s);
}

// Authoritative "lab" providers rank higher than resellers when matching.
const PREFERRED = ['openai', 'anthropic', 'google', 'mistral', 'deepseek', 'xai', 'meta', 'alibaba', 'moonshotai', 'zai', 'minimax', 'qwen'];

async function getIndex() {
  const db = await getModelsDev();
  if (!db) return null;
  if (cache.index) return cache.index;
  const exact = new Map();
  const base = new Map();
  const byProvider = new Map();
  for (const [pid, p] of Object.entries(db)) {
    const rank = PREFERRED.includes(pid) ? 0 : 1;
    const scoped = new Map();
    byProvider.set(pid, scoped);
    for (const [mid, m] of Object.entries(p.models || {})) {
      const entry = { providerId: pid, model: m, rank };
      scoped.set(String(mid).toLowerCase(), entry);
      if (!scoped.has(baseName(mid))) scoped.set(baseName(mid), entry);
      for (const [map, key] of [
        [exact, `${pid}/${mid}`.toLowerCase()],
        [exact, String(mid).toLowerCase()],
        [base, baseName(mid)],
      ]) {
        const prev = map.get(key);
        if (!prev || entry.rank < prev.rank) map.set(key, entry);
      }
    }
  }
  cache.index = { exact, base, byProvider, db };
  return cache.index;
}

function matchModel(index, id, providerId) {
  if (!index) return null;
  const lower = String(id).toLowerCase();
  // Prefer the endpoint's own provider entry on models.dev (it carries that provider's pricing).
  const scoped = providerId && index.byProvider.get(providerId);
  if (scoped) {
    const hit = scoped.get(lower) || scoped.get(baseName(id));
    if (hit) return { ...hit, sameProvider: true };
  }
  return index.exact.get(lower) || index.exact.get(lower.replace(/:.*$/, '')) || index.base.get(baseName(id)) || null;
}

function hostOf(url) {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
}

async function providerHint(baseURL) {
  const host = hostOf(baseURL);
  const builtin = [
    [/api\.openai\.com$/, { id: 'openai', npm: '@ai-sdk/openai', env: ['OPENAI_API_KEY'], name: 'OpenAI' }],
    [/api\.anthropic\.com$/, { id: 'anthropic', npm: '@ai-sdk/anthropic', env: ['ANTHROPIC_API_KEY'], name: 'Anthropic' }],
    [/openrouter\.ai$/, { id: 'openrouter', npm: '@openrouter/ai-sdk-provider', env: ['OPENROUTER_API_KEY'], name: 'OpenRouter' }],
    [/(localhost|127\.0\.0\.1):11434$/, { id: 'ollama', npm: '@ai-sdk/openai-compatible', env: [], name: 'Ollama (local)' }],
    [/(localhost|127\.0\.0\.1):1234$/, { id: 'lmstudio', npm: '@ai-sdk/openai-compatible', env: [], name: 'LM Studio (local)' }],
  ];
  for (const [re, hint] of builtin) if (re.test(host)) return { ...hint, source: 'builtin' };
  const db = await getModelsDev();
  if (db && host) {
    for (const p of Object.values(db)) {
      if (p.api && hostOf(p.api) === host) {
        return { id: p.id, npm: p.npm || '@ai-sdk/openai-compatible', env: p.env || [], name: p.name, doc: p.doc, source: 'models.dev' };
      }
    }
  }
  const labels = host.replace(/:\d+$/, '').split('.');
  const isLocal = labels.length === 1 || /^\d+$/.test(labels[labels.length - 1]);
  const id = (isLocal ? 'local' : labels[labels.length - 2]).replace(/[^a-z0-9-]/g, '-') || 'custom';
  if (db && db[id]) {
    // Known provider, but the pasted URL is its OpenAI-style API, so stay openai-compatible.
    const p = db[id];
    return { id, npm: '@ai-sdk/openai-compatible', env: p.env || [], name: p.name, doc: p.doc, source: 'models.dev' };
  }
  return {
    id,
    npm: '@ai-sdk/openai-compatible',
    env: [id.toUpperCase().replace(/-/g, '_') + '_API_KEY'],
    name: id.charAt(0).toUpperCase() + id.slice(1),
    source: 'guess',
  };
}

// ---------- endpoint model listing ----------

// Accept pasted URLs like ".../v1/models" or ".../v1/chat/completions".
function normalizeBase(url) {
  return url.trim().replace(/\/+$/, '').replace(/\/(chat\/completions|completions|responses|models)$/i, '');
}

function modelsUrls(baseURL) {
  const b = normalizeBase(baseURL);
  const urls = [`${b}/models`];
  if (!/\/v\d+[a-z]*$/i.test(b)) urls.push(`${b}/v1/models`);
  // Ollama native API as a fallback.
  const root = b.replace(/\/v1$/, '');
  urls.push(`${root}/api/tags`);
  return urls;
}

function extractList(json) {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== 'object') return null;
  for (const k of ['data', 'models', 'result', 'items']) if (Array.isArray(json[k])) return json[k];
  return null;
}

const NON_CHAT = /(embed|embedding|whisper|tts|transcri|speech|dall-e|image-gen|imagen|stable-diffusion|sdxl|flux|rerank|moderation|guard|audio|realtime|davinci|babbage|clip|ocr|vision-encoder|[-_/]image([-_.]|$)|text-to-|video-gen|wan[-_]?\d)/i;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function perMillion(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n * 1e6 * 10000) / 10000;
}

function prettyName(id) {
  const last = String(id).split('/').pop().replace(/:free$/, ' (free)');
  return last
    .split(/[-_]/)
    .map((w) => (/^\d/.test(w) || w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

// Turn one raw endpoint model + optional models.dev match into a suggested
// OpenCode (legacy `provider.*.models.*`) entry, tracking where each value came from.
function buildSuggestion(raw, match) {
  const id = raw.id || raw.name || raw.model;
  const md = match?.model;
  const sources = {};
  const pick = (key, endpointVal, mdVal) => {
    if (endpointVal !== undefined && endpointVal !== null) {
      sources[key] = 'endpoint';
      return endpointVal;
    }
    if (mdVal !== undefined && mdVal !== null) {
      sources[key] = 'models.dev';
      return mdVal;
    }
    return undefined;
  };

  const params = Array.isArray(raw.supported_parameters) ? raw.supported_parameters : null;
  const inMods = raw.architecture?.input_modalities || raw.input_modalities || raw.modalities?.input;
  const outMods = raw.architecture?.output_modalities || raw.output_modalities || raw.modalities?.output;
  const caps = raw.capabilities && !Array.isArray(raw.capabilities) ? raw.capabilities : {};
  const capList = Array.isArray(raw.capabilities) ? raw.capabilities : [];

  const endpointTools = params ? params.includes('tools') : caps.function_calling ?? caps.tools ?? (capList.length ? capList.includes('tools') : undefined);
  const endpointReasoning = params ? params.includes('reasoning') || params.includes('include_reasoning') : caps.reasoning ?? (capList.length ? capList.includes('thinking') : undefined);
  const endpointTemp = params ? params.includes('temperature') : undefined;
  const endpointVision = Array.isArray(inMods) ? inMods.some((m) => m === 'image' || m === 'file' || m === 'pdf') : caps.vision ?? (capList.length ? capList.includes('vision') : undefined);

  const context = pick(
    'context',
    num(raw.context_length) ?? num(raw.context_window) ?? num(raw.max_context_length) ?? num(raw.top_provider?.context_length) ?? num(raw.max_model_len) ?? num(raw.context),
    num(md?.limit?.context)
  );
  const output = pick(
    'output',
    num(raw.top_provider?.max_completion_tokens) ?? num(raw.max_output_tokens) ?? num(raw.max_completion_tokens) ?? num(raw.max_tokens),
    num(md?.limit?.output)
  );

  let cost;
  if (raw.pricing && (raw.pricing.prompt !== undefined || raw.pricing.input !== undefined)) {
    const inp = perMillion(raw.pricing.prompt ?? raw.pricing.input);
    const out = perMillion(raw.pricing.completion ?? raw.pricing.output);
    if (inp !== undefined && out !== undefined) {
      cost = { input: inp, output: out };
      const cr = perMillion(raw.pricing.input_cache_read);
      const cw = perMillion(raw.pricing.input_cache_write);
      if (cr) cost.cache_read = cr;
      if (cw) cost.cache_write = cw;
      sources.cost = 'endpoint';
    }
  }
  // Only borrow models.dev prices when the endpoint IS that provider; resellers price differently.
  if (!cost && md?.cost && match?.sameProvider) {
    cost = { ...md.cost };
    delete cost.context_over_200k;
    sources.cost = 'models.dev';
  }

  const suggestion = {
    name: raw.name && raw.name !== id ? raw.name : md?.name || prettyName(id),
  };
  sources.name = raw.name && raw.name !== id ? 'endpoint' : md?.name ? 'models.dev' : 'generated';

  const tool_call = pick('tool_call', endpointTools, md?.tool_call);
  const reasoning = pick('reasoning', endpointReasoning, md?.reasoning);
  const attachment = pick('attachment', endpointVision, md?.attachment);
  const temperature = pick('temperature', endpointTemp, md?.temperature);
  if (tool_call !== undefined) suggestion.tool_call = !!tool_call;
  if (reasoning !== undefined) suggestion.reasoning = !!reasoning;
  if (attachment !== undefined) suggestion.attachment = !!attachment;
  if (temperature !== undefined) suggestion.temperature = !!temperature;
  if (context || output) {
    // OpenCode requires both when `limit` is present.
    suggestion.limit = { context: context || 128000, output: output || Math.min(8192, context || 8192) };
    if (!context) sources.context = 'default';
    if (!output) sources.output = 'default';
  }
  if (cost) suggestion.cost = cost;
  const modIn = Array.isArray(inMods) ? inMods : md?.modalities?.input;
  const modOut = Array.isArray(outMods) ? outMods : md?.modalities?.output;
  const allowed = ['text', 'audio', 'image', 'video', 'pdf'];
  if (modIn && modOut) {
    const fi = modIn.map((m) => (m === 'file' ? 'pdf' : m)).filter((m) => allowed.includes(m));
    const fo = modOut.filter((m) => allowed.includes(m));
    if (fi.length && fo.length && (fi.length > 1 || fo.length > 1)) suggestion.modalities = { input: [...new Set(fi)], output: [...new Set(fo)] };
  }
  const releaseDate = md?.release_date || (raw.created ? new Date(raw.created * 1000).toISOString().slice(0, 10) : undefined);
  if (releaseDate && /^\d{4}-\d{2}(-\d{2})?$/.test(releaseDate)) suggestion.release_date = releaseDate;

  const outputs = Array.isArray(outMods) ? outMods : md?.modalities?.output;
  const nonChat = NON_CHAT.test(id) || (Array.isArray(outputs) && !outputs.includes('text')) || raw.type === 'embedding' || raw.object === 'embedding';
  const free = /:free$/.test(id) || (cost && cost.input === 0 && cost.output === 0);
  const recommended = !nonChat && suggestion.tool_call !== false;

  return {
    id,
    suggestion,
    sources,
    match: match ? { provider: match.providerId, id: md.id, name: md.name } : null,
    owned_by: raw.owned_by || raw.top_provider?.name,
    description: raw.description ? String(raw.description).slice(0, 300) : md?.description,
    nonChat,
    free,
    recommended,
  };
}

async function discover({ baseURL, apiKey, headers }) {
  if (!baseURL || !/^https?:\/\//i.test(baseURL)) throw new Error('Base URL must start with http:// or https://');
  const key = resolveValue(apiKey || '');
  const h = resolveHeaders(headers);
  if (key && !h.Authorization && !h.authorization) h.Authorization = `Bearer ${key}`;
  // Anthropic-style endpoints authenticate with x-api-key.
  if (key && /anthropic\.com/.test(baseURL)) {
    h['x-api-key'] = key;
    h['anthropic-version'] = '2023-06-01';
  }

  const attempts = [];
  let list = null;
  let usedUrl = null;
  for (const url of modelsUrls(baseURL)) {
    const r = await fetchJson(url, { headers: h });
    attempts.push({ url, status: r.status, ok: r.ok, error: r.ok ? undefined : r.text.slice(0, 300) });
    const l = r.ok ? extractList(r.json) : null;
    if (l) {
      list = l;
      usedUrl = url;
      break;
    }
    if (r.status === 401 || r.status === 403) break;
  }
  if (!list) {
    const err = new Error('Could not list models from this endpoint.');
    err.attempts = attempts;
    throw err;
  }

  const [index, hint] = await Promise.all([getIndex(), providerHint(baseURL)]);
  const models = list
    .map((raw) => (typeof raw === 'string' ? { id: raw } : raw))
    .filter((raw) => raw && (raw.id || raw.name || raw.model))
    .map((raw) => {
      if (!raw.id && raw.model) raw = { ...raw, id: raw.model };
      if (!raw.id && raw.name) raw = { ...raw, id: raw.name, name: undefined };
      const m = matchModel(index, raw.id, hint.source === 'guess' ? null : hint.id);
      return buildSuggestion(raw, m);
    })
    .sort((a, b) => Number(b.recommended) - Number(a.recommended) || a.id.localeCompare(b.id));

  return {
    baseURL: usedUrl.replace(/\/(models|api\/tags)$/, '').replace(/\/api$/, ''),
    usedUrl,
    attempts,
    hint,
    modelsDev: !!index,
    models,
  };
}

// Sends a tiny chat completion to verify a model actually answers.
async function testModel({ baseURL, apiKey, headers, model }) {
  const h = { 'Content-Type': 'application/json', ...resolveHeaders(headers) };
  const key = resolveValue(apiKey || '');
  if (key && !h.Authorization) h.Authorization = `Bearer ${key}`;
  const started = Date.now();
  const r = await fetchJson(baseURL.replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST',
    headers: h,
    timeout: 60000,
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with just the word OK.' }], max_tokens: 2048 }),
  });
  const ms = Date.now() - started;
  if (!r.ok) return { ok: false, status: r.status, ms, error: r.json?.error?.message || r.text };
  const msg = r.json?.choices?.[0]?.message || {};
  const reply = msg.content || msg.reasoning_content || msg.reasoning || '';
  return { ok: true, status: r.status, ms, reply: String(reply).slice(0, 200), usage: r.json?.usage };
}

// ---------- schema ----------

async function getSchema() {
  if (cache.schema) return cache.schema;
  const r = await fetchJson(SCHEMA_URL, { timeout: 10000 });
  if (r.ok && r.json?.properties) {
    cache.schema = { schema: r.json, source: 'live' };
    return cache.schema;
  }
  try {
    cache.schema = { schema: JSON.parse(fs.readFileSync(BUNDLED_SCHEMA, 'utf8')), source: 'bundled' };
  } catch {
    cache.schema = { schema: null, source: 'none' };
  }
  return cache.schema;
}

module.exports = { discover, testModel, getSchema, getModelsDev, resolveValue, SCHEMA_URL, BUNDLED_SCHEMA };
