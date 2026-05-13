/**
 * fetch: HTTP/URL fetch tool for pi.
 *
 * Registers a `fetch` tool the LLM can call to retrieve URL content
 * directly, without having to shell out through bash + curl (which
 * mangles output formatting on some local models). Supports
 * GET/POST/PUT/PATCH/DELETE/HEAD, custom headers, request body for
 * write methods, a configurable response cap, and a request timeout.
 *
 * Why this exists:
 *   - Read documentation pages, raw GitHub files, API responses
 *   - Hit local services (LM Studio at :1234, dev servers, etc.)
 *   - Check service health / poke an endpoint to debug
 *   - Avoid bash-tool-call brittleness around piped curl output
 *
 * Safety: http:// and https:// only; file://, ftp://, etc. are
 * rejected. Response body is capped at 256 KB by default (4 MB hard
 * cap) so a single fetch can't blow up the context window.
 *
 * Pairs with claude-mode: this extension also appears in claude-mode's
 * ASK_TOOLS list so it stays callable after a /plan → /ask cycle. It
 * is intentionally NOT in PLAN_TOOLS — plan mode is for local
 * exploration, not network calls.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const MAX_BYTES_DEFAULT = 256 * 1024;
const MAX_BYTES_HARD_CAP = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 1_000;

const FetchParams = Type.Object({
  url: Type.String({ description: "URL to fetch (http:// or https:// only)" }),
  method: Type.Optional(
    StringEnum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] as const),
  ),
  headers: Type.Optional(
    Type.Record(Type.String(), Type.String(), {
      description: "Request headers as a flat string→string map",
    }),
  ),
  body: Type.Optional(
    Type.String({
      description:
        "Request body for POST/PUT/PATCH. Raw string — JSON callers should stringify themselves and set Content-Type",
    }),
  ),
  max_bytes: Type.Optional(
    Type.Number({
      description: `Cap response body in bytes (default ${MAX_BYTES_DEFAULT}, hard cap ${MAX_BYTES_HARD_CAP})`,
    }),
  ),
  timeout_ms: Type.Optional(
    Type.Number({
      description: `Request timeout in milliseconds (default ${DEFAULT_TIMEOUT_MS}, minimum ${MIN_TIMEOUT_MS})`,
    }),
  ),
});

interface FetchDetails {
  url: string;
  method: string;
  status: number;
  statusText: string;
  contentType: string | null;
  responseHeaders: Record<string, string>;
  bytesReturned: number;
  truncated: boolean;
  elapsedMs: number;
}

async function readBodyCapped(
  response: Response,
  maxBytes: number,
): Promise<{ buf: Uint8Array; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) {
    return { buf: new Uint8Array(0), truncated: false };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    const remaining = maxBytes - total;
    if (value.byteLength <= remaining) {
      chunks.push(value);
      total += value.byteLength;
      continue;
    }
    if (remaining > 0) {
      chunks.push(value.subarray(0, remaining));
      total += remaining;
    }
    truncated = true;
    try {
      await reader.cancel();
    } catch {
      // The peer may already be gone; nothing meaningful to do.
    }
    break;
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  return { buf, truncated };
}

export default function fetchExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "fetch",
    label: "Fetch URL",
    description:
      "Fetch a URL over HTTP/HTTPS and return the response body as text. Use for reading documentation pages, hitting local or remote HTTP APIs, checking service health, and retrieving raw files from GitHub or other static hosts. http:// and https:// only.",
    promptSnippet:
      "Fetch a URL over HTTP/HTTPS and return its response body (GET/POST/PUT/PATCH/DELETE/HEAD)",
    promptGuidelines: [
      "Use fetch when you need to read a URL the user references — documentation, raw GitHub files, API responses — instead of asking the user to paste contents.",
      "Use fetch with a local URL (e.g. http://localhost:1234/v1/models) to probe dev services rather than running curl through bash.",
      "Do not use fetch as a substitute for read/write/edit on local files; those tools handle paths, file:// is not supported here.",
    ],
    parameters: FetchParams,

    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      if (signal?.aborted) {
        throw new Error(`Cancelled before request: ${String(signal.reason ?? "aborted")}`);
      }

      const url = params.url.trim();
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new Error(`Invalid URL: ${url}`);
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error(
          `Unsupported protocol: ${parsed.protocol} (only http:// and https:// are allowed)`,
        );
      }

      const method = params.method ?? "GET";
      const maxBytes = Math.min(
        Math.max(1, params.max_bytes ?? MAX_BYTES_DEFAULT),
        MAX_BYTES_HARD_CAP,
      );
      const timeoutMs = Math.max(MIN_TIMEOUT_MS, params.timeout_ms ?? DEFAULT_TIMEOUT_MS);

      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(new Error(`Timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
      const onParentAbort = () => controller.abort(signal?.reason);
      signal?.addEventListener("abort", onParentAbort, { once: true });

      const requestHeaders: Record<string, string> = { ...(params.headers ?? {}) };
      if (!Object.keys(requestHeaders).some((k) => k.toLowerCase() === "user-agent")) {
        requestHeaders["User-Agent"] = "pi-fetch-extension/1.0";
      }

      const t0 = Date.now();
      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers: requestHeaders,
          body: method === "GET" || method === "HEAD" ? undefined : params.body,
          signal: controller.signal,
          redirect: "follow",
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Request failed: ${msg}`);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onParentAbort);
      }

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((v, k) => {
        responseHeaders[k] = v;
      });
      const contentType = response.headers.get("content-type");

      if (method === "HEAD") {
        const elapsedMs = Date.now() - t0;
        const details: FetchDetails = {
          url,
          method,
          status: response.status,
          statusText: response.statusText,
          contentType,
          responseHeaders,
          bytesReturned: 0,
          truncated: false,
          elapsedMs,
        };
        const headerLines = Object.entries(responseHeaders)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n");
        return {
          content: [
            {
              type: "text",
              text: `${response.status} ${response.statusText} (${elapsedMs}ms)\n${headerLines}`,
            },
          ],
          details,
        };
      }

      let buf: Uint8Array;
      let truncated: boolean;
      try {
        ({ buf, truncated } = await readBodyCapped(response, maxBytes));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to read response body: ${msg}`);
      }
      const elapsedMs = Date.now() - t0;
      const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);

      const details: FetchDetails = {
        url,
        method,
        status: response.status,
        statusText: response.statusText,
        contentType,
        responseHeaders,
        bytesReturned: buf.byteLength,
        truncated,
        elapsedMs,
      };

      const sizeNote = truncated
        ? `${buf.byteLength} bytes returned, truncated at cap ${maxBytes}`
        : `${buf.byteLength} bytes`;
      const header =
        `${response.status} ${response.statusText} (${elapsedMs}ms, ${sizeNote})\n` +
        `Content-Type: ${contentType ?? "(none)"}\n\n`;

      return {
        content: [{ type: "text", text: header + text }],
        details,
      };
    },
  });
}
