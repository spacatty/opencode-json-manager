'use strict';

// Text files OpenCode reads besides opencode.json: rules (AGENTS.md), markdown
// agents and commands, and the ignore files ripgrep respects. Only paths this
// module lists can be read or written, so the API can't touch arbitrary files.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { globalConfigDir } = require('./config');

// Folders that hold one markdown file per entry. Singular names are still read
// by OpenCode for backwards compatibility, so list them when they exist.
const MD_DIRS = [
  { key: 'agents', label: 'Agents', legacy: 'agent' },
  { key: 'commands', label: 'Commands', legacy: 'command' },
  { key: 'modes', label: 'Modes', legacy: 'mode' },
];

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.md$/;

function fileInfo(p, extra) {
  let st = null;
  try {
    st = fs.statSync(p);
  } catch {
    /* missing */
  }
  return { path: p, name: path.basename(p), exists: !!st && st.isFile(), size: st?.isFile() ? st.size : 0, mtime: st?.isFile() ? st.mtimeMs : null, ...extra };
}

function listMd(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md'))
      .map((e) => path.join(dir, e.name))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

// Returns groups of files for the global scope and the project at cwd.
function listFiles(cwd = process.cwd()) {
  const g = globalConfigDir();
  const proj = path.resolve(cwd);
  const groups = [];

  groups.push({
    scope: 'global',
    id: 'global-rules',
    label: 'Rules',
    dir: g,
    files: [
      fileInfo(path.join(g, 'AGENTS.md'), { kind: 'rules', note: 'Global rules for every session' }),
      fileInfo(path.join(os.homedir(), '.claude', 'CLAUDE.md'), { kind: 'rules', note: 'Fallback, read only when the global AGENTS.md is missing' }),
    ],
  });
  for (const d of MD_DIRS) {
    const dir = path.join(g, d.key);
    const legacy = path.join(g, d.legacy);
    groups.push({ scope: 'global', id: `global-${d.key}`, label: d.label, dir, canCreate: true, files: [...listMd(dir), ...listMd(legacy)].map((p) => fileInfo(p, { kind: d.key })) });
  }

  const opDir = path.join(proj, '.opencode');
  groups.push({
    scope: 'project',
    id: 'project-rules',
    label: 'Rules',
    dir: proj,
    files: [
      fileInfo(path.join(proj, 'AGENTS.md'), { kind: 'rules', note: 'Project rules' }),
      fileInfo(path.join(proj, 'CLAUDE.md'), { kind: 'rules', note: 'Fallback, read only when AGENTS.md is missing' }),
    ],
  });
  groups.push({
    scope: 'project',
    id: 'project-ignore',
    label: 'Ignore files',
    dir: proj,
    files: [
      fileInfo(path.join(proj, '.gitignore'), { kind: 'ignore', note: 'Hidden from search and listing tools' }),
      fileInfo(path.join(proj, '.ignore'), { kind: 'ignore', note: 'Overrides .gitignore for ripgrep, e.g. !dist/' }),
    ],
  });
  for (const d of MD_DIRS) {
    const dir = path.join(opDir, d.key);
    const legacy = path.join(opDir, d.legacy);
    groups.push({ scope: 'project', id: `project-${d.key}`, label: d.label, dir, canCreate: true, files: [...listMd(dir), ...listMd(legacy)].map((p) => fileInfo(p, { kind: d.key })) });
  }
  return { globalDir: g, projectDir: proj, groups };
}

function allowed(p, cwd) {
  const abs = path.resolve(p);
  const { groups } = listFiles(cwd);
  if (groups.some((gr) => gr.files.some((f) => f.path === abs))) return abs;
  // New files inside a markdown folder.
  const dir = path.dirname(abs);
  if (NAME_RE.test(path.basename(abs)) && groups.some((gr) => gr.canCreate && gr.dir === dir)) return abs;
  throw new Error('This file is not one OpenCode reads, so it cannot be edited here.');
}

function readFile(p, cwd) {
  const abs = allowed(p, cwd);
  const info = fileInfo(abs);
  return { ...info, content: info.exists ? fs.readFileSync(abs, 'utf8') : '' };
}

function writeFile(p, content, cwd) {
  if (typeof content !== 'string') throw new Error('content must be a string');
  const abs = allowed(p, cwd);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  let backup = null;
  if (fs.existsSync(abs)) {
    backup = abs + '.bak';
    fs.copyFileSync(abs, backup);
  }
  const tmp = abs + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, abs);
  return { ...fileInfo(abs), backup };
}

function createFile(groupId, name, cwd) {
  const gr = listFiles(cwd).groups.find((x) => x.id === groupId && x.canCreate);
  if (!gr) throw new Error('Unknown folder');
  if (!name.toLowerCase().endsWith('.md')) name += '.md';
  if (!NAME_RE.test(name)) throw new Error('Use letters, numbers, dots, dashes or underscores, e.g. review.md');
  const abs = path.join(gr.dir, name);
  if (fs.existsSync(abs)) throw new Error(`${name} already exists`);
  const stem = name.slice(0, -3);
  const body =
    gr.id.endsWith('agents')
      ? `---\ndescription: What the ${stem} agent does and when to use it\nmode: subagent\n---\n\nYou are ...\n`
      : gr.id.endsWith('commands')
        ? `---\ndescription: What /${stem} does\n---\n\nPrompt for the command. $ARGUMENTS is replaced with what follows the command.\n`
        : `---\ndescription: ${stem}\n---\n\n`;
  return writeFile(abs, body, cwd);
}

// "Delete" keeps the content: the file is renamed to <name>.bak, so it stops
// being read (it no longer ends in .md) but can be restored by hand.
function removeFile(p, cwd) {
  const abs = allowed(p, cwd);
  if (!fs.existsSync(abs)) throw new Error('File does not exist');
  const backup = abs + '.bak';
  fs.renameSync(abs, backup);
  return { backup };
}

module.exports = { listFiles, readFile, writeFile, createFile, removeFile };
