'use strict';
/** overhead.js — DEPRECATED alias: the overhead snapshot is now part of `review`. */
const os = require('os');
const path = require('path');
const { collectOverhead } = require('./collectors');

function fmt(n) { return Math.round(n).toLocaleString('en-US'); }

async function runOverhead(opts = {}) {
  const targetDir = opts.dir ? path.resolve(opts.dir) : process.cwd();
  const home = opts._home || os.homedir();
  const oh = collectOverhead(targetDir, home);
  console.log('\nNOTE: `overhead` is now part of `review` (run `token-diet review`).\n');
  console.log(`per-spawn total: ${fmt(oh.perSpawnTotal)} tokens`);
  console.log('Cost per round if N agents spawned:');
  for (const n of [1, 5, 10]) console.log(`  N=${String(n).padEnd(3)} ${fmt(oh.perSpawnTotal * n).padStart(10)} tokens`);
  console.log('');
}

module.exports = { runOverhead };
