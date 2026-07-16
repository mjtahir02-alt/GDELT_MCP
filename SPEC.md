# GDELT MCP Server Specification

## Objective

Build a remote, read-only Model Context Protocol server that gives MCP-compatible AI clients structured access to global media intelligence from the public GDELT DOC 2.0 API.

## Operating model

- GitHub is the source of truth for normal, uncompressed source files.
- Vercel is the remote runtime.
- MCP transport is stateless Streamable HTTP.
- Primary MCP endpoint: `/mcp` (rewritten internally to `/api/mcp`).
- Health endpoint: `/health` (rewritten internally to `/api/health`).
- The server requires no GDELT API key and exposes read-only tools only.

## MCP tools

1. `search_articles`
   - Search global news coverage through GDELT DOC Article List mode.
   - Support GDELT query syntax, relative or precise time ranges, sorting and bounded result counts.
2. `get_coverage_timeline`
   - Return normalized coverage intensity or raw article-count timelines.
3. `get_tone_timeline`
   - Return average news-tone timelines for a query.
4. `get_source_country_timeline`
   - Compare the share of coverage across publishing countries over time.

The retired GDELT GEO endpoint is deliberately excluded because its documented public URL currently returns HTTP 404.

## Functional requirements

- Validate every tool input before calling GDELT.
- Accept GDELT keyword, exact-phrase, Boolean OR and advanced query operators.
- Allow structured filters for source country, source language, domain, theme and tone.
- Support `timespan` or precise `startDateTime` / `endDateTime`, but reject ambiguous combinations.
- Bound article results to 1–250.
- Return both text and `structuredContent` for compatibility across MCP clients.
- Include the GDELT request URL and retrieval timestamp in tool outputs.
- Clearly identify GDELT as a media-monitoring signal rather than verified ground truth.

## Reliability and safety

- Use a 25-second upstream timeout.
- Serialize live GDELT requests at least 5.5 seconds apart per warm instance.
- Retry HTTP 429 once after at least six seconds and respect `Retry-After` when present.
- Cache successful identical GDELT responses in memory for five minutes.
- Cap response payload size before returning it to the MCP client.
- Apply lightweight per-instance MCP request throttling.
- Reject invalid browser origins while permitting non-browser server-to-server MCP clients.
- Never execute arbitrary code, fetch user-supplied URLs or modify external systems.
- Never commit secrets. Optional configuration is supplied through environment variables.

## Compatibility

- Support MCP protocol versions `2025-06-18` and `2025-03-26`.
- Support `initialize`, `ping`, `tools/list`, `tools/call` and initialization notifications.
- Return HTTP 405 for unsupported GET/SSE and DELETE operations.
- Declare every tool as read-only, non-destructive and `noauth`.

## Testing

- Unit-test query construction, precise date conversion, filtering, response-size limits and protocol behavior.
- Unit-test MCP initialization, tool listing, successful calls, invalid arguments and upstream errors.
- Run clean installation, syntax checks and tests in GitHub Actions before deployment.
- Production validation requires a successful Vercel build and health response.
