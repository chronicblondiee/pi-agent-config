---
name: brave-search
description: Web search via Brave Search API. Use to look up current documentation, API references, news, facts, or any information not in training data. Requires BRAVE_API_KEY environment variable.
---

# Brave Search

Search the live web for current information.

## Prerequisites

Set `BRAVE_API_KEY` in your environment. Get one at [brave.com/search/api](https://brave.com/search/api/).

## Usage

```bash
# Basic search (returns titles + URLs)
node /path/to/brave-search/search.js "React 19 server components tutorial"

# Search with page content extraction
node /path/to/brave-search/search.js "React 19 server components" --content

# Limit results
node /path/to/brave-search/search.js "latest Rust async patterns" --count 5

# Search specific type
node /path/to/brave-search/search.js "site:github.com pi-coding-agent" --type web
```

## Arguments

| Flag | Default | Description |
|------|---------|-------------|
| `--content` | false | Fetch and summarize top result page content |
| `--count` | 5 | Number of results to return |
| `--type` | `web` | Search type: `web`, `news`, `locations` |

## Workflow

1. Search for the information you need
2. Review results for relevant URLs
3. If needed, re-run with `--content` to get page details
4. Use extracted information to proceed with the task

## Notes

- Search results include titles, URLs, and snippets
- With `--content`, the top result's page is fetched and summarized
- If `BRAVE_API_KEY` is not set, the script will fail with a clear error
- For code-specific queries, prepend `site:github.com` or `site:stackoverflow.com` to narrow results
