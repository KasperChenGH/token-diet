'use strict';
const fs   = require('fs');
const os   = require('os');
const path = require('path');

/** Make an isolated tmp dir; returns its path. Caller cleans up. */
function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tdiet-'));
}

/** Write a file (creating parent dirs) under `root`. Returns the absolute path. */
function writeFile(root, relPath, content) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

/** Recursively remove a dir (best-effort). */
function rm(root) {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
}

module.exports = { tmpDir, writeFile, rm };
