'use strict';

// Minimal JSONC support: strips // and /* */ comments and trailing commas,
// while leaving string contents untouched.
function stripJsonc(text) {
  let out = '';
  let i = 0;
  let inString = false;
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (inString) {
      out += c;
      if (c === '\\') {
        out += n ?? '';
        i += 2;
        continue;
      }
      if (c === '"') inString = false;
      i++;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      i++;
      continue;
    }
    if (c === '/' && n === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && n === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    out += c;
    i++;
  }
  return removeTrailingCommas(out);
}

function removeTrailingCommas(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\') {
        out += text[++i] ?? '';
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === '}' || text[j] === ']') continue;
    }
    out += c;
  }
  return out;
}

function parseJsonc(text) {
  const cleaned = stripJsonc(text.replace(/^﻿/, ''));
  if (!cleaned.trim()) return {};
  return JSON.parse(cleaned);
}

function hasComments(text) {
  return stripJsonc(text).replace(/\s/g, '') !== text.replace(/\s/g, '');
}

module.exports = { parseJsonc, stripJsonc, hasComments };
