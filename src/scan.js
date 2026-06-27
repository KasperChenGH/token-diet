'use strict';
/**
 * scan.js — JSONL streaming reader for Claude Code transcripts
 *
 * Data lives at: ~/.claude/projects/<project-slug>/<uuid>.jsonl
 * Agent sub-sessions have filenames starting with "agent-"
 *
 * Relevant lines (type:"assistant") carry:
 *   message.usage.input_tokens
 *   message.usage.cache_creation_input_tokens
 *   message.usage.cache_read_input_tokens
 *   message.usage.output_tokens
 *   message.model  — e.g. "claude-sonnet-4-6"
 *   timestamp      — ISO string
 *   message.content[] entries with type:"tool_use" for tool calls
 *
 * DEDUP NOTE: Claude Code emits 2-3 consecutive assistant lines per API call
 * (one per content block: thinking / text / tool_use).  All lines for the same
 * API call share the same top-level `requestId` (stable, always present) and
 * also the same `message.id`.  The `message.usage` object is IDENTICAL on every
 * duplicate line, so summing naively inflates all token totals 2-3×.
 *
 * Strategy: token counts are recorded only for the FIRST line seen for each
 * requestId (or message.id as fallback).  tool_use blocks are collected across
 * ALL lines so no tool call is missed.  `calls` = number of distinct IDs.
 *
 * Tool result tracking (Lever 8):
 *   type:"user" lines carry message.content[] entries with type:"tool_result".
 *   Each tool_result records {tool_use_id, result_tokens, calls_before} where
 *   calls_before = number of distinct assistant requestIds already seen in this
 *   file when the result appears.  result_tokens = len(content_text) / 4.
 *   Per-file summary: toolResults[] and totalCalls (= final seenRequestIds size).
 *   tool_use records are also keyed by id in toolCallsById for the join in diagnose.
 */

// ── PLATFORM DEPENDENCY (ADR) ───────────────────────────────────────────────────
// token-diet's MEASUREMENT layer is coupled to Claude Code's on-disk transcript format:
//   • path:    ~/.claude/projects/<slug>/*.jsonl   (and one level of agent-* sub-dirs)
//   • shape:   newline-delimited JSON; `type:"assistant"` lines carry `message.usage`
//              (input/cache_creation/cache_read/output tokens) + `requestId` for dedup;
//              `type:"user"` lines carry tool_result blocks; tool_use blocks carry id+name+input.
// If Anthropic changes this format, scan/audit/agents/diagnose/compare/digest break (the
// methodology in SKILL.md is platform-neutral; the CLI is NOT). A non-Claude-Code adapter
// would map its own transcripts to {requestId, usage, tool_use, tool_result} and feed scanAll.
// Decision: own the Claude Code niche; keep this the single coupling point.
const fs       = require('fs');
const path     = require('path');
const os       = require('os');
const readline = require('readline');

// Coarse chars/token approximation for tool-result sizing (no file extension to key on).
const APPROX_CHARS_PER_TOKEN = 4;

// Above this size, stream the file line-by-line instead of buffering the whole thing into a
// string. The buffered path is ~25% faster (no per-line event overhead) and fine for typical
// transcripts, but a single multi-hundred-MB session would otherwise pin that many bytes of heap
// per concurrent read. Streaming keeps memory bounded on pathological inputs; same per-line logic.
const STREAM_THRESHOLD_BYTES = 64 * 1024 * 1024;

// ── helpers ──────────────────────────────────────────────────────────────────

function modelFamily(modelStr) {
  if (!modelStr) return 'other';
  const m = modelStr.toLowerCase();
  if (m.includes('opus'))   return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku'))  return 'haiku';
  return 'other';
}

function sessionKind(filename) {
  return path.basename(filename).startsWith('agent-') ? 'subagent' : 'session';
}

/** Parse project dirs matching an optional substring filter */
function resolveProjectDirs(projectFilter) {
  const base = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(base)) return [];

  const allDirs = fs.readdirSync(base, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => path.join(base, d.name));

  if (!projectFilter) return allDirs;

  // Allow slug substring or absolute path
  if (path.isAbsolute(projectFilter) && fs.existsSync(projectFilter)) {
    return [projectFilter];
  }
  const lower = projectFilter.toLowerCase();
  return allDirs.filter(d => path.basename(d).toLowerCase().includes(lower));
}

/**
 * Collect all .jsonl files (including in immediate subdirs like agent sub-dirs).
 * Returns an array of absolute file paths.
 *
 * `withStats: true` returns `{ path, mtimeMs, size }` objects instead, so scanAll
 * can window-skip files older than the cutoff without opening them (mtime of an
 * append-only transcript is >= every record's timestamp). statSync failures fall
 * back to mtimeMs = Infinity (never skipped — opened and line-filtered).
 */
function collectJsonlFiles(projectDirs, opts = {}) {
  const withStats = opts.withStats === true;
  const files = [];
  const push = (p) => {
    if (!withStats) { files.push(p); return; }
    let st; try { st = fs.statSync(p); } catch { st = null; }
    files.push({ path: p, mtimeMs: st ? st.mtimeMs : Infinity, size: st ? st.size : 0 });
  };
  for (const dir of projectDirs) {
    // Direct .jsonl files in the project dir
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { continue; }

    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.jsonl')) {
        push(path.join(dir, e.name));
      } else if (e.isDirectory()) {
        // One level down — agent sub-session dirs
        let sub;
        try { sub = fs.readdirSync(path.join(dir, e.name), { withFileTypes: true }); }
        catch { continue; }
        for (const se of sub) {
          if (se.isFile() && se.name.endsWith('.jsonl')) {
            push(path.join(dir, e.name, se.name));
          }
        }
      }
    }
  }
  return files;
}

/**
 * Extract plain text from a tool_result content field.
 * content is either a string or an array of {type:"text", text:"..."} blocks.
 */
function toolResultText(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(b => b && b.type === 'text')
      .map(b => b.text || '')
      .join('');
  }
  return '';
}

/**
 * Stream a single .jsonl file, yielding parsed records.
 * Returns a Promise that resolves when done.
 *
 * onRecord(record) is called for each *valid* assistant line within the
 * requested time window.
 *
 * record shape:
 * {
 *   file, sessionId, sessionKind, modelFamily, model, timestamp,
 *   input, cacheWrite, cacheRead, output,        ← token counts
 *   toolCalls:   [ { id, name, input } ]         ← tool_use entries (id added for Lever 8 join)
 *   toolResults: [ { tool_use_id, result_tokens, calls_before } ]  ← Lever 8
 *   totalCalls:  number   ← distinct assistant requestIds in this file (set at close)
 * }
 *
 * NOTE: toolResults / totalCalls are file-level aggregates collected per-file
 * and attached to the FIRST record emitted from that file (the file-summary record).
 * diagnose.js reads them from a separate per-file accumulator to avoid coupling
 * to individual record ordering; scan exposes them via onFileDone callback.
 */
/**
 * Assumed Claude Code transcript schema — the single fragile coupling point (see the file-top
 * note). A line is parsed only if it contains `"usage"` or `tool_result`; any missing/renamed
 * field degrades gracefully (the line is skipped, never throws). If a future Claude Code build
 * renames these fields, THIS module is where to adapt — every other module consumes the
 * normalized Record below, not the raw JSONL.
 *
 * @typedef {Object} Record
 * @property {string}  file         transcript path (also the per-session aggregation key)
 * @property {string}  sessionId    obj.sessionId, else the filename stem
 * @property {string}  sessionKind  'session' | 'subagent' (agent-*.jsonl → subagent)
 * @property {string}  model        message.model ('' if absent)
 * @property {string}  modelFamily  opus | sonnet | haiku | other
 * @property {?string} timestamp    ISO string or null
 * @property {number}  input        usage.input_tokens
 * @property {number}  cacheWrite   usage.cache_creation_input_tokens
 * @property {number}  cacheRead    usage.cache_read_input_tokens
 * @property {number}  output       usage.output_tokens
 * @property {{name:string, filePath:?string}[]} toolCalls  in-window tool_use blocks
 *
 * @param {string} filePath
 * @param {number} cutoffMs                 records older than this are excluded (0 = no filter)
 * @param {(r: Record) => void} onRecord    called once per deduped in-window call
 * @param {(m: {file:string, toolResults:Array, toolCallsById:Map, totalCalls:number}) => void} [onFileDone]
 */
async function streamFile(filePath, cutoffMs, onRecord, onFileDone) {
  // Per-file dedup state.
  const pendingRecords = new Map();  // id → record (built up as we scan; flushed at end)
  const seenRequestIds = new Set();  // distinct in-window assistant callIds (calls_before / totalCalls)
  const toolCallsById  = new Map();  // tool_use_id → { name, input } for the Lever 8 join
  const fileToolResults = [];        // { tool_use_id, result_tokens, calls_before } (Lever 8)

  const processLine = (line) => {
    // Cheap substring pre-filter before the (expensive) JSON.parse: only assistant lines
    // (which always carry a `"usage"` object) and tool_result lines (`tool_result`) feed any
    // measurement. Most lines are thinking/text/summary/system — skipping their parse is a
    // large CPU win (~58% of lines in a real 97 MB session). No false skips (a real assistant
    // line always has "usage", a tool_result line "tool_result"); a false KEEP is harmless,
    // discarded by the type checks below.
    if (line.indexOf('"usage"') < 0 && line.indexOf('tool_result') < 0) return;
    let obj;
    try { obj = JSON.parse(line); }
    catch { return; }

    // ── Handle user-type lines (tool_result blocks) ─────────────────────
    if (obj.type === 'user') {
      if (obj.message && Array.isArray(obj.message.content)) {
        for (const c of obj.message.content) {
          if (c && c.type === 'tool_result') {
            const text   = toolResultText(c.content);
            const tokens = Math.round(text.length / APPROX_CHARS_PER_TOKEN);
            fileToolResults.push({
              tool_use_id:  c.tool_use_id || '',
              result_tokens: tokens,
              calls_before:  seenRequestIds.size,
              is_error:     c.is_error === true,   // for trace's retry-streak detection (Lever 3 behavioral)
            });
          }
        }
      }
      return; // user lines carry no usage — done
    }

    if (obj.type !== 'assistant') return;

    const usage = obj.message && obj.message.usage;
    if (!usage) return;

    // Derive a stable per-API-call id. requestId is on every assistant line in current
    // Claude Code builds; fall back to message.id (older transcripts). If BOTH are absent,
    // synthesize a key from timestamp + usage so the 2-3 content-block lines of ONE call
    // (identical ts+usage) dedup to one, while distinct calls stay distinct — rather than
    // counting every no-id line separately (which would double-count old transcripts).
    const tsRaw = obj.timestamp || (obj.message && obj.message.timestamp) || null;
    const callId = obj.requestId || (obj.message && obj.message.id) ||
      `noid:${tsRaw || ''}|${usage.input_tokens || 0}|${usage.cache_creation_input_tokens || 0}|${usage.cache_read_input_tokens || 0}|${usage.output_tokens || 0}`;

    if (!pendingRecords.has(callId)) {
      // First line for this callId — apply the time filter once.
      if (cutoffMs && tsRaw) {
        const ms = Date.parse(tsRaw);
        if (!isNaN(ms) && ms < cutoffMs) {
          pendingRecords.set(callId, null);   // mark filtered so duplicate lines skip too
          return;
        }
      }
      // In-window first sighting: count the call exactly once.
      seenRequestIds.add(callId);   // only in-window calls feed calls_before / totalCalls
      const record = {
        file:        filePath,
        sessionId:   obj.sessionId || path.basename(filePath, '.jsonl'),
        sessionKind: sessionKind(filePath),
        model:       (obj.message && obj.message.model) || '',
        modelFamily: modelFamily((obj.message && obj.message.model) || ''),
        timestamp:   tsRaw,
        input:       +(usage.input_tokens || 0),
        cacheWrite:  +(usage.cache_creation_input_tokens || 0),
        cacheRead:   +(usage.cache_read_input_tokens || 0),
        output:      +(usage.output_tokens || 0),
        toolCalls:   [],
      };
      pendingRecords.set(callId, record);
    }

    // Collect tool_use ids into the file-level registry for ALL lines,
    // even time-filtered ones — tool_results may reference calls from before
    // the cutoff, so we need the id→{name,input} mapping regardless.
    if (obj.message && Array.isArray(obj.message.content)) {
      for (const c of obj.message.content) {
        if (c && c.type === 'tool_use' && c.id) {
          toolCallsById.set(c.id, { name: c.name || '', input: c.input || {} });
        }
      }
    }

    // Retrieve the record (may be null if time-filtered)
    const record = pendingRecords.get(callId);
    if (!record) return; // time-filtered — token counts already excluded

    // Collect tool_use blocks into the record's toolCalls list (in-window only)
    if (obj.message && Array.isArray(obj.message.content)) {
      for (const c of obj.message.content) {
        if (c && c.type === 'tool_use') {
          const fp = c.input && (c.input.file_path || c.input.path || null);
          // `id` lets trace join the ordered call to its result (status/tokens via toolCallsById +
          // fileToolResults) for loop/retry detection; full args stay in toolCallsById (not duplicated here).
          record.toolCalls.push({ name: c.name || '', filePath: fp || null, id: c.id || '' });
        }
      }
    }
  };

  // Pick the read strategy by file size: buffer typical files (fast), stream huge ones (bounded
  // memory). Both feed the SAME processLine, so the per-line result is identical either way.
  let size = -1;
  try { size = (await fs.promises.stat(filePath)).size; } catch { return; }   // unreadable — skip

  // Env override (also the seam tests use to exercise the streaming branch without a 64 MB file).
  const threshold = Number(process.env.TOKEN_DIET_STREAM_THRESHOLD) || STREAM_THRESHOLD_BYTES;
  if (size <= threshold) {
    // Buffered path: one bulk read + manual line split (avoids readline's per-line event overhead
    // — ~25% faster on a 97 MB session). \r is trimmed so CRLF behaves exactly as readline did.
    let data;
    try { data = await fs.promises.readFile(filePath, 'utf8'); }
    catch { return; }
    let i = 0;
    const len = data.length;
    while (i < len) {
      let j = data.indexOf('\n', i);
      if (j < 0) j = len;
      let end = j;
      if (end > i && data.charCodeAt(end - 1) === 13) end--;   // strip trailing \r (CRLF)
      if (end > i) processLine(data.slice(i, end));
      i = j + 1;
    }
  } else {
    // Streaming path for very large files — bounded memory. crlfDelay:Infinity coalesces \r\n so
    // each line arrives without a trailing \r, matching the buffered path's hand-rolled strip.
    await new Promise((resolve) => {
      let rl;
      try { rl = readline.createInterface({ input: fs.createReadStream(filePath, 'utf8'), crlfDelay: Infinity }); }
      catch { resolve(); return; }
      rl.on('line', (line) => { if (line) processLine(line); });
      rl.on('close', resolve);
      rl.on('error', () => { try { rl.close(); } catch { /* ignore */ } resolve(); });  // mid-stream error → flush what we have
    });
  }

  // Flush all deduped records in insertion order (null = time-filtered → skip).
  for (const [, record] of pendingRecords) {
    if (record) onRecord(record);
  }
  // Deliver per-file tool_result + tool_use data (Lever 8).
  if (onFileDone) {
    onFileDone({
      file:         filePath,
      toolResults:  fileToolResults,
      toolCallsById,
      totalCalls:   seenRequestIds.size,
    });
  }
}

/**
 * Main entry: scan all matching project dirs for records in the last N days.
 * Returns Promise<{ records, fileMeta }>
 *   records  — array of per-call records (existing shape, unchanged)
 *   fileMeta — Map<filePath, { toolResults, toolCallsById, totalCalls }>
 *              (Lever 8 data; only populated for files that had at least one line)
 */
// Margin (ms) subtracted from the cutoff before window-skipping a file by mtime:
// covers clock skew and files whose mtime was bumped (e.g. restore/copy) without
// new content. Generous on purpose — a wrongly-OPENED old file is just filtered
// line-by-line (correct, slightly slower); a wrongly-SKIPPED file would be a bug.
const SKEW_MS = 24 * 3600_000;

// Read at most this many transcript files concurrently. The work is I/O-bound, so
// a small pool collapses wall-clock from sum-of-files to ~max/concurrency without
// risking file-descriptor exhaustion on a project with hundreds of sessions.
function readConcurrency() {
  let cpus = 4;
  try { cpus = os.cpus().length || 4; } catch { /* keep default */ }
  return Math.max(1, Math.min(cpus, 8));
}

async function scanAll(opts = {}) {
  const days     = opts.days != null ? +opts.days : 2;
  const project  = opts.project || null;
  const cutoffMs = days > 0 ? Date.now() - days * 86400_000 : null;

  const dirs  = resolveProjectDirs(project);
  let files   = collectJsonlFiles(dirs, { withStats: true });

  // ── Phase 1: window-skip ────────────────────────────────────────────────────
  // Transcripts are append-only, so a file's mtime >= every record's timestamp.
  // A file last modified before (cutoff - skew) therefore cannot hold an in-window
  // record — skip it WITHOUT opening it. This is byte-identical to what the per-line
  // Date.parse filter in streamFile would drop anyway. cutoffMs == null → no skip;
  // statSync failures recorded mtimeMs = Infinity above → never skipped.
  if (cutoffMs != null) {
    const floor = cutoffMs - SKEW_MS;
    files = files.filter(f => f.mtimeMs >= floor);
  }
  // Preserve readdir collection order (NOT a re-sort): record/aggregation order then
  // matches the previous sequential implementation exactly, so parallelizing below
  // cannot shift any equal-key tie-break in the consumers.
  const paths = files.map(f => f.path);

  // ── Phase 2: bounded-concurrency reads, deterministic reassembly ─────────────
  // Each file streams into its OWN slot (indexed by collection order); slots are
  // merged in order afterwards, so the result is independent of which read finishes
  // first — same records, same order, as the old `for…await` loop.
  const perFile = new Array(paths.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= paths.length) return;
      const slot = { records: [], meta: null };
      perFile[i] = slot;
      await streamFile(
        paths[i],
        cutoffMs,
        r => slot.records.push(r),
        meta => { slot.meta = {
          toolResults:   meta.toolResults,
          toolCallsById: meta.toolCallsById,
          totalCalls:    meta.totalCalls,
        }; },
      );
    }
  };
  const poolSize = Math.min(readConcurrency(), paths.length || 1);
  await Promise.all(Array.from({ length: poolSize }, worker));

  const records  = [];
  const fileMeta = new Map(); // filePath → { toolResults, toolCallsById, totalCalls }
  for (let i = 0; i < paths.length; i++) {
    const slot = perFile[i];
    if (!slot) continue;
    for (const r of slot.records) records.push(r);
    if (slot.meta) fileMeta.set(paths[i], slot.meta);
  }
  return { records, fileMeta };
}

module.exports = { scanAll, modelFamily, sessionKind, resolveProjectDirs, collectJsonlFiles };
