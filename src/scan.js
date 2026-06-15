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

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const readline = require('readline');

// ── helpers ──────────────────────────────────────────────────────────────────

function modelFamily(modelStr) {
  if (!modelStr) return 'other';
  const m = modelStr.toLowerCase();
  if (m.includes('fable'))  return 'fable';
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

/** Collect all .jsonl files (including in immediate subdirs like agent sub-dirs) */
function collectJsonlFiles(projectDirs) {
  const files = [];
  for (const dir of projectDirs) {
    // Direct .jsonl files in the project dir
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { continue; }

    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.jsonl')) {
        files.push(path.join(dir, e.name));
      } else if (e.isDirectory()) {
        // One level down — agent sub-session dirs
        let sub;
        try { sub = fs.readdirSync(path.join(dir, e.name), { withFileTypes: true }); }
        catch { continue; }
        for (const se of sub) {
          if (se.isFile() && se.name.endsWith('.jsonl')) {
            files.push(path.join(dir, e.name, se.name));
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
function streamFile(filePath, cutoffMs, onRecord, onFileDone) {
  return new Promise((resolve, reject) => {
    let stream;
    try {
      stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    } catch (e) {
      return resolve(); // unreadable — skip
    }

    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    // Per-file dedup state.
    // pendingRecords: id → record (built up as we scan; flushed on close)
    const pendingRecords = new Map(); // id → record

    // seenRequestIds: set of distinct assistant callIds seen so far in this file.
    // Used to compute calls_before for tool_results.
    const seenRequestIds = new Set();

    // Per-file tool_use registry: id → { name, input } for Lever 8 join.
    const toolCallsById = new Map(); // tool_use_id → { name, input }

    // Per-file tool_result accumulator (Lever 8).
    const fileToolResults = []; // { tool_use_id, result_tokens, calls_before }

    rl.on('line', (line) => {
      if (!line.trim()) return;
      let obj;
      try { obj = JSON.parse(line); }
      catch { return; }

      // ── Handle user-type lines (tool_result blocks) ─────────────────────
      if (obj.type === 'user') {
        if (obj.message && Array.isArray(obj.message.content)) {
          for (const c of obj.message.content) {
            if (c && c.type === 'tool_result') {
              const text   = toolResultText(c.content);
              const tokens = Math.round(text.length / 4);
              fileToolResults.push({
                tool_use_id:  c.tool_use_id || '',
                result_tokens: tokens,
                calls_before:  seenRequestIds.size,
              });
            }
          }
        }
        return; // user lines carry no usage — done
      }

      if (obj.type !== 'assistant') return;

      const usage = obj.message && obj.message.usage;
      if (!usage) return;

      // Derive stable per-API-call id.
      // requestId is present on every assistant line in current Claude Code builds.
      // Fall back to message.id if requestId is absent (older transcripts).
      // If neither is present, use a sentinel so we still count the line once.
      const callId = obj.requestId || (obj.message && obj.message.id) || null;

      // Track distinct assistant call ids (for calls_before snapshots above)
      if (callId !== null) seenRequestIds.add(callId);

      // Timestamp filter — apply on first encounter of this callId
      const tsRaw = obj.timestamp || (obj.message && obj.message.timestamp) || null;
      if (!pendingRecords.has(callId)) {
        // First line for this callId — apply time filter
        if (cutoffMs && tsRaw) {
          const ms = Date.parse(tsRaw);
          if (!isNaN(ms) && ms < cutoffMs) {
            // Mark as time-filtered so duplicate lines are also skipped
            pendingRecords.set(callId, null);
            return;
          }
        }

        // Create the record (tokens counted exactly once)
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
          // null callId means no stable id — we will emit immediately (no dedup)
          _noId:       callId === null,
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
            record.toolCalls.push({ name: c.name || '', filePath: fp || null });
          }
        }
      }

      // For lines without a stable id, emit immediately (no dedup possible)
      if (record._noId) {
        delete record._noId;
        pendingRecords.delete(callId);
        onRecord(record);
      }
    });

    rl.on('close', () => {
      // Flush all deduped records in insertion order
      for (const [, record] of pendingRecords) {
        if (record && !record._noId) {
          delete record._noId;
          onRecord(record);
        }
      }
      // Deliver per-file tool_result + tool_use data (Lever 8)
      if (onFileDone) {
        onFileDone({
          file:         filePath,
          toolResults:  fileToolResults,
          toolCallsById,
          totalCalls:   seenRequestIds.size,
        });
      }
      resolve();
    });
    rl.on('error', () => resolve()); // skip errored files
  });
}

/**
 * Main entry: scan all matching project dirs for records in the last N days.
 * Returns Promise<{ records, fileMeta }>
 *   records  — array of per-call records (existing shape, unchanged)
 *   fileMeta — Map<filePath, { toolResults, toolCallsById, totalCalls }>
 *              (Lever 8 data; only populated for files that had at least one line)
 */
async function scanAll(opts = {}) {
  const days     = opts.days != null ? +opts.days : 2;
  const project  = opts.project || null;
  const cutoffMs = days > 0 ? Date.now() - days * 86400_000 : null;

  const dirs  = resolveProjectDirs(project);
  const files = collectJsonlFiles(dirs);

  const records  = [];
  const fileMeta = new Map(); // filePath → { toolResults, toolCallsById, totalCalls }

  for (const f of files) {
    await streamFile(
      f,
      cutoffMs,
      r => records.push(r),
      meta => fileMeta.set(meta.file, {
        toolResults:  meta.toolResults,
        toolCallsById: meta.toolCallsById,
        totalCalls:   meta.totalCalls,
      }),
    );
  }
  return { records, fileMeta };
}

module.exports = { scanAll, modelFamily, sessionKind, resolveProjectDirs, collectJsonlFiles };
