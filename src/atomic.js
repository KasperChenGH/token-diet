'use strict';
/** atomic.js — crash-safe file writes: write a temp file in the same dir, then rename.
 *  Same-directory rename is atomic on POSIX and close to it on Windows, so a kill or
 *  power-loss mid-write leaves either the old file or the complete new one — never a
 *  truncated/empty file that the next JSON.parse would choke on. Zero-dep. */
const fs   = require('fs');
const path = require('path');

function writeFileAtomic(file, data) {
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, data);
  try { fs.renameSync(tmp, file); }
  catch (e) { try { fs.unlinkSync(tmp); } catch { /* ignore */ } throw e; }
}

module.exports = { writeFileAtomic };
