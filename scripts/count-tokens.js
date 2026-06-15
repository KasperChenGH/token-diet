'use strict';
/** count-tokens — shared bytes/4 token estimator (used by estimate, digester, trimmer). */
const fs = require('fs');

function tokensForFile(filePath) {
  try { return Math.round(fs.statSync(filePath).size / 4); } catch { return 0; }
}
function tokensForText(text) {
  if (text == null) return 0;
  return Math.round(Buffer.byteLength(text, 'utf8') / 4);
}

module.exports = { tokensForFile, tokensForText };
