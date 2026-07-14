/**
 * web-search: no-key web search tool for pi.
 *
 * Uses DuckDuckGo's HTML endpoint so there is no API key or package
 * dependency. This is useful for ad hoc lookups, but intentionally documented
 * as parser-brittle because DuckDuckGo does not provide this HTML as a stable
 * machine API.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS_CAP = 10;
const MAX_RESPONSE_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

const WebSearchParams = Type.Object({
	query: Type.String({ description: "Search query" }),
	max_results: Type.Optional(
		Type.Number({
			description: `Maximum results to return (default ${DEFAULT_MAX_RESULTS}, hard cap ${MAX_RESULTS_CAP})`,
		}),
	),
	site: Type.Optional(
		Type.String({
			description: "Optional site/domain restriction, e.g. example.com",
		}),
	),
});

interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}

function decodeHtml(input: string): string {
	const named: Record<string, string> = {
		amp: "&",
		apos: "'",
		gt: ">",
		lt: "<",
		nbsp: " ",
		quot: '"',
	};
	return input
		.replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
		.replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCharCode(Number.parseInt(n, 16)))
		.replace(/&([a-z]+);/gi, (m, name) => named[name.toLowerCase()] ?? m);
}

function stripTags(input: string): string {
	return decodeHtml(input.replace(/<[^>]*>/g, " "))
		.replace(/\s+/g, " ")
		.trim();
}

function resultUrlFromHref(href: string): string | null {
	const decoded = decodeHtml(href);
	try {
		const parsed = new URL(decoded, "https://duckduckgo.com");
		const uddg = parsed.searchParams.get("uddg");
		if (uddg) return uddg;
		if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.toString();
	} catch {
		return null;
	}
	return null;
}

function parseResults(html: string, maxResults: number): SearchResult[] {
	const results: SearchResult[] = [];
	const seen = new Set<string>();
	const resultBlockRe = /<div[^>]+class="[^"]*\bresult\b[^"]*"[\s\S]*?(?=<div[^>]+class="[^"]*\bresult\b|<\/body>)/gi;
	const blocks = html.match(resultBlockRe) ?? [];

	for (const block of blocks) {
		const titleMatch = block.match(/<a[^>]+class="[^"]*\bresult__a\b[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
		if (!titleMatch) continue;
		const url = resultUrlFromHref(titleMatch[1]);
		if (!url || seen.has(url)) continue;

		const snippetMatch = block.match(/<a[^>]+class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
		const snippet = snippetMatch ? stripTags(snippetMatch[1]) : "";
		const title = stripTags(titleMatch[2]);
		if (!title) continue;

		seen.add(url);
		results.push({ title, url, snippet });
		if (results.length >= maxResults) break;
	}

	return results;
}

async function readCapped(response: Response): Promise<{ text: string; truncated: boolean }> {
	const reader = response.body?.getReader();
	if (!reader) return { text: "", truncated: false };

	const chunks: Uint8Array[] = [];
	let total = 0;
	let truncated = false;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;
		const remaining = MAX_RESPONSE_BYTES - total;
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
		await reader.cancel().catch(() => undefined);
		break;
	}

	const buf = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		buf.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return { text: new TextDecoder("utf-8", { fatal: false }).decode(buf), truncated };
}

export default function webSearchExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description:
			"Search the public web using DuckDuckGo HTML results and return titles, URLs, and snippets. No API key required; parser may break if DuckDuckGo changes its HTML.",
		promptSnippet: "Search the web for current public information (DuckDuckGo HTML, no API key)",
		promptGuidelines: [
			"Use web_search only when online mode is enabled and a web lookup is needed.",
			"Prefer the site parameter for targeted documentation or source lookups.",
			"Treat results as search leads. Fetch or inspect authoritative pages before relying on precise claims.",
		],
		parameters: WebSearchParams,

		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const rawQuery = params.query.trim();
			if (!rawQuery) throw new Error("query is required");

			const site = params.site?.trim();
			const query = site ? `${rawQuery} site:${site}` : rawQuery;
			const maxResults = Math.min(
				MAX_RESULTS_CAP,
				Math.max(1, Math.floor(params.max_results ?? DEFAULT_MAX_RESULTS)),
			);
			const url = new URL("https://html.duckduckgo.com/html/");
			url.searchParams.set("q", query);

			const controller = new AbortController();
			const timer = setTimeout(
				() => controller.abort(new Error(`Timed out after ${DEFAULT_TIMEOUT_MS}ms`)),
				DEFAULT_TIMEOUT_MS,
			);
			const onParentAbort = () => controller.abort(signal?.reason);
			signal?.addEventListener("abort", onParentAbort, { once: true });

			let response: Response;
			const startedAt = Date.now();
			try {
				response = await fetch(url, {
					method: "GET",
					headers: {
						Accept: "text/html",
						"User-Agent": "pi-web-search-extension/1.0",
					},
					redirect: "follow",
					signal: controller.signal,
				});
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				throw new Error(`Web search request failed: ${msg}`);
			} finally {
				clearTimeout(timer);
				signal?.removeEventListener("abort", onParentAbort);
			}

			if (!response.ok) {
				throw new Error(`Web search request failed: ${response.status} ${response.statusText}`);
			}

			const { text: html, truncated } = await readCapped(response);
			const elapsedMs = Date.now() - startedAt;
			const results = parseResults(html, maxResults);
			const lines =
				results.length === 0
					? [
							`No results parsed for "${query}" (${elapsedMs}ms).`,
							truncated
								? `Response was truncated at ${MAX_RESPONSE_BYTES} bytes.`
								: "DuckDuckGo may have changed its HTML or returned an interstitial.",
						]
					: results.flatMap((result, index) => [
							`${index + 1}. ${result.title}`,
							`   ${result.url}`,
							result.snippet ? `   ${result.snippet}` : "",
						]).filter(Boolean);

			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: {
					query,
					site: site || null,
					backend: "duckduckgo-html",
					elapsedMs,
					truncated,
					results,
				},
			};
		},
	});
}
