#!/usr/bin/env node

/**
 * Brave Search CLI
 *
 * Usage:
 *   node search.js "query" [--content] [--count N] [--type web|news|locations]
 *
 * Requires BRAVE_API_KEY in environment.
 */

const API_KEY = process.env.BRAVE_API_KEY;
if (!API_KEY) {
  console.error("Error: BRAVE_API_KEY not set");
  process.exit(1);
}

const args = process.argv.slice(2);
const query = args[0];
if (!query) {
  console.error("Usage: node search.js <query> [--content] [--count N] [--type web|news|locations]");
  process.exit(1);
}

const options = {
  content: args.includes("--content"),
  count: 5,
  type: "web",
};

for (let i = 1; i < args.length; i++) {
  if (args[i] === "--count" && args[i + 1]) {
    options.count = parseInt(args[i + 1], 10);
    i++;
  }
  if (args[i] === "--type" && args[i + 1]) {
    options.type = args[i + 1];
    i++;
  }
}

async function search(query, options) {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(options.count));

  const response = await fetch(url.toString(), {
    headers: {
      "Accept": "application/json",
      "Accept-Encoding": "identity",
      "X-Subscription-Token": API_KEY,
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`Brave API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.web?.results ?? [];
}

async function fetchPageContent(url) {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PiAgent/1.0)",
        "Accept": "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) return null;

    const html = await response.text();
    // Strip tags
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // Return first 3000 chars
    return text.slice(0, 3000);
  } catch {
    return null;
  }
}

async function main() {
  try {
    const results = await search(query, options);

    if (results.length === 0) {
      console.log("No results found.");
      return;
    }

    console.log(`Search results for: ${query}\n`);

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      console.log(`${i + 1}. ${r.title}`);
      console.log(`   ${r.url}`);
      if (r.description) {
        console.log(`   ${r.description}`);
      }
      console.log();
    }

    if (options.content && results[0]?.url) {
      console.log("--- Page content (top result) ---\n");
      const content = await fetchPageContent(results[0].url);
      if (content) {
        console.log(content);
      } else {
        console.log("(Could not fetch page content)");
      }
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
