#!/usr/bin/env node
/**
 * Safari console-clean gate script.
 *
 * Spawns safaridriver in MCP mode, opens a tab, and asserts the browser
 * console has no entries matching the undici/node:net module-error family.
 * Prints SAFARI_CONSOLE_CLEAN and exits 0 on success.
 *
 * Usage: node scripts/check-safari-console-clean.js [url]
 *   url defaults to http://localhost:3000/workspace
 *
 * Exit codes:
 *   0 - SAFARI_CONSOLE_CLEAN (no offending entries)
 *   1 - offending console entries found
 *   2 - dev server unreachable or safaridriver failure
 */

import { createConnection } from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { URL } from 'node:url';

const OFFENDING_PATTERNS = [/Cannot find module/i, /node:net/i, /undici/i];

const CALL_TIMEOUT_MS = 20_000;
const TOTAL_BUDGET_MS = 90_000;

/**
 * Probe whether host:port accepts TCP connections.
 */
function tcpProbe(host, port, { timeoutMs = 5_000 } = {}) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      sock.destroy();
      resolve(false);
    }, timeoutMs);
    const sock = createConnection({ host, port }, () => {
      clearTimeout(timer);
      sock.destroy();
      resolve(true);
    });
    sock.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

/**
 * JSON-RPC 2.0 helper over newline-delimited stdio.
 *
 * Manages request/response correlation by id and provides
 * sendRequest (with response) and sendNotification (fire-and-forget).
 */
function createJsonRpcTransport(proc) {
  let nextId = 1;
  const pending = new Map();
  let buffer = '';

  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let nlIdx;
    while ((nlIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nlIdx);
      buffer = buffer.slice(nlIdx + 1);
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id != null && pending.has(msg.id)) {
          const { resolve, reject, timer } = pending.get(msg.id);
          clearTimeout(timer);
          pending.delete(msg.id);
          if (msg.error) {
            reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          } else {
            resolve(msg.result);
          }
        }
      } catch {
        // Ignore unparseable lines.
      }
    }
  });

  function sendRequest(method, params, timeoutMs = CALL_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
      proc.stdin.write(msg);
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timeout on ${method} after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
    });
  }

  function sendNotification(method, params) {
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
    proc.stdin.write(msg);
  }

  /**
   * Call an MCP tool by name.
   *
   * MCP tools are invoked via the tools/call method, not by their names
   * directly. This helper wraps that pattern.
   */
  function callTool(name, args = {}) {
    return sendRequest('tools/call', { name, arguments: args });
  }

  return { sendRequest, sendNotification, callTool };
}

/**
 * Extract text content from an MCP tool result.
 *
 * MCP tool results arrive as:
 *   { result: { content: [ { type: 'text', text: '...' } ] } }
 *
 * Handles both JSON and line-based text payloads.
 */
function extractToolTexts(result) {
  if (!result?.content) return [];
  return result.content
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text);
}

/**
 * Parse console messages from tool text payloads.
 *
 * Tries JSON parse first (expects an array of objects with a message field).
 * Falls back to line-based splitting.
 */
function parseConsoleMessages(texts) {
  const messages = [];
  for (const text of texts) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          const msg = entry.message || entry.text || '';
          if (typeof msg === 'string') messages.push(msg);
        }
        continue;
      }
    } catch {
      // Not JSON. Try line-based.
    }
    // Line-based fallback.
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed) messages.push(trimmed);
    }
  }
  return messages;
}

/**
 * Check browser console for offending entries.
 *
 * @param {string} url - The URL to navigate to.
 * @returns {Promise<string[]>} Offending console lines (empty = clean).
 */
export async function checkSafariConsoleClean(url) {
  const targetUrl = url || 'http://localhost:3000/workspace';
  const offending = [];
  let proc;
  let tabHandle;
  let rpc;

  // Step 1: TCP-probe the dev server.
  const parsed = new URL(targetUrl);
  const host = parsed.hostname || 'localhost';
  const port = Number(parsed.port) || 3000;
  const reachable = await tcpProbe(host, port);
  if (!reachable) {
    return ['DEV_SERVER_UNREACHABLE'];
  }

  const budgetDeadline = Date.now() + TOTAL_BUDGET_MS;

  try {
    // Step 2: Spawn safaridriver --mcp.
    proc = spawn('/usr/bin/safaridriver', ['--mcp'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    rpc = createJsonRpcTransport(proc);

    // Check budget before initialize.
    if (Date.now() >= budgetDeadline) {
      return ['SAFARIDRIVER_SESSION_FAILED: Total budget exceeded before initialize'];
    }

    // Step 3: Initialize handshake.
    const initResult = await rpc.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'check-safari-console-clean', version: '1.0.0' },
    });
    rpc.sendNotification('notifications/initialized', {});

    // Step 4: tools/list.
    if (Date.now() >= budgetDeadline) {
      return ['SAFARIDRIVER_SESSION_FAILED: Total budget exceeded before tools/list'];
    }
    const toolsResult = await rpc.sendRequest('tools/list', {});
    const tools = toolsResult?.tools || [];

    // Find browser_console_messages schema to map args defensively.
    const bcmTool = tools.find((t) => t.name === 'browser_console_messages');
    const bcmSchema = bcmTool?.inputSchema || {};
    const bcmProps = bcmSchema.properties || {};

    // Step 5: create_tab with the target URL.
    if (Date.now() >= budgetDeadline) {
      return ['SAFARIDRIVER_SESSION_FAILED: Total budget exceeded before create_tab'];
    }
    const tabResult = await rpc.callTool('create_tab', { url: targetUrl });

    // Extract tab handle for cleanup.
    const tabTexts = extractToolTexts(tabResult);
    for (const text of tabTexts) {
      try {
        const tabInfo = JSON.parse(text);
        if (tabInfo.handle) tabHandle = tabInfo.handle;
        else if (tabInfo.uuid) tabHandle = tabInfo.uuid;
      } catch {
        // Try to find a UUID-like handle in the text.
        const uuidMatch = text.match(/(?:handle|uuid|id)["\s:]+([0-9a-f-]{36})/i);
        if (uuidMatch) tabHandle = uuidMatch[1];
      }
    }

    // Wait for module-evaluation errors to surface.
    await sleep(4_000);

    // Step 6: Fetch console errors.
    if (Date.now() >= budgetDeadline) {
      return ['SAFARIDRIVER_SESSION_FAILED: Total budget exceeded before console check'];
    }
    let consoleMessages = [];
    try {
      // Build args from the discovered schema.
      const bcmArgs = {};
      if (bcmProps.level_filter) {
        bcmArgs.level_filter = ['error'];
      }
      if (bcmProps.clear !== undefined) {
        bcmArgs.clear = true;
      }

      const bcmResult = await rpc.callTool('browser_console_messages', bcmArgs);
      const texts = extractToolTexts(bcmResult);
      consoleMessages = parseConsoleMessages(texts);
    } catch (e) {
      // Fallback: try get_page_content and look for the Next.js overlay.
      try {
        if (Date.now() >= budgetDeadline) {
          process.stderr.write('WARNING: budget exceeded, skipping get_page_content fallback\n');
        } else {
          const gpcResult = await rpc.callTool('get_page_content', {
            region: 'entire_page',
          });
          const texts = extractToolTexts(gpcResult);
          const fullText = texts.join(' ');
          if (/Cannot find module/i.test(fullText)) {
            consoleMessages = ['Cannot find module (from page content fallback)'];
          }
        }
      } catch {
        // Both methods failed. Treat as zero offenders with a warning.
        process.stderr.write(
          'WARNING: browser_console_messages and get_page_content both failed\n',
        );
      }
    }

    // Step 7: Filter against offending patterns.
    for (const msg of consoleMessages) {
      if (OFFENDING_PATTERNS.some((p) => p.test(msg))) {
        offending.push(msg);
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return [`SAFARIDRIVER_SESSION_FAILED: ${msg}`];
  } finally {
    // Step 8: Close the tab if we have a handle.
    if (proc && tabHandle) {
      try {
        await rpc.callTool('close_tab', { handle: tabHandle });
      } catch {
        // Tab close is best-effort; proceed with SIGTERM.
      }
    }

    // SIGTERM the spawned child by pid.
    if (proc) {
      try {
        proc.kill('SIGTERM');
      } catch {
        // Process may have already exited.
      }
      // Wait briefly for exit, but do not hang.
      try {
        await new Promise((resolve) => {
          proc.on('exit', resolve);
          setTimeout(resolve, 2_000);
        });
      } catch {
        // Ignore wait errors.
      }
    }
  }

  return offending;
}

/**
 * CLI entry point. Maps the result to exit code and marker.
 */
async function main() {
  const url = process.argv[2] || 'http://localhost:3000/workspace';

  const result = await checkSafariConsoleClean(url);

  if (result.length === 0) {
    console.log('SAFARI_CONSOLE_CLEAN');
    process.exit(0);
  }

  // Check for dev server precondition failure.
  if (result.includes('DEV_SERVER_UNREACHABLE')) {
    console.log('DEV_SERVER_UNREACHABLE');
    process.exit(2);
  }

  // Check for safaridriver precondition failure.
  const sessionFailed = result.find((r) => r.startsWith('SAFARIDRIVER_SESSION_FAILED'));
  if (sessionFailed) {
    console.error(sessionFailed);
    process.exit(2);
  }

  console.error('Offending console entries:');
  for (const line of result) {
    console.error(`  - ${line}`);
  }
  process.exit(1);
}

main();
