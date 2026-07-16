# GDELT MCP Server Specification

## Objective

Build a remote, read-only Model Context Protocol server that gives MCP-compatible AI clients structured access to global news intelligence from the public GDELT DOC 2.0 and GEO 2.0 APIs.

## Operating model

- GitHub will be the source of truth for normal, uncompressed source files.
- Vercel is the intended remote runtime.
- MCP transport is stateless Streamable HTTP.
- Primary MCP endpoint: `/mcp` (rewritten internally to `/api/mcp`).
- Health endpoint: `/health` (rewritten internally to `/api/health`).
- The initial release requires no API key and exposes read-only tools only.

## MCP tools

1. `search_articles`
   - Search global news coverage through the GDELT DOC 2.0 Article List mode.
   - Support GDELT query syntax, relative or precise time ranges, sorting and bounded result counts.
2. `get_coverage_timeline`
   - Return normalized coverage intensity or raw article-count timelines.
3. `get_tone_timeline`
   - Return average news-tone timelines for a query.
4. `get_source_country_timeline`
   - Compare the share of coverage across publishing countries over time.
5. `map_news_locations`
   - Return GeoJSON locations mentioned in matching coverage through the GDELT GEO 2.0 API.

## Functional requirements

- Validate every tool input before calling GDELT.
- Accept GDELT keyword, exact-phrase, Boolean OR and advanced query operators.
- Allow structured filters for source country, source language, domain, theme and tone.
- Support `timespan` or precise `startDateTime` / `endDateTime`, but reject ambiguous combinations.
- Bound article results to 1–250 and map points to 1–1,000.
- Return both text and `structuredContent` for compatibility across MCP clients.
- Include the GDELT request URL and retrieval timestamp in tool outputs.
- Clearly identify GDELT as a media-monitoring signal rather than verified ground truth.

## Reliability and safety

- Use a 25-second upstream timeout and one retry for transient GDELT failures.
- Cap response payload size before returning it to the MCP client.
- Apply lightweight per-instance request throttling.
- Reject invalid browser origins while permitting non-browser server-to-server MCP clients.
- Never execute arbitrary code, fetch user-supplied URLs or modify external systems.
- Never commit secrets. Optional configuration is supplied through environment variables.

## Compatibility

- Support MCP protocol versions `2025-06-18` and `2025-03-26`.
- Support `initialize`, `ping`, `tools/list`, `tools/call` and initialization notifications.
- Return HTTP 405 for unsupported GET/SSE and DELETE operations.
- Declare every tool as read-only, non-destructive and `noauth`.

## Testing

- Unit-test query construction, precise date conversion, filter composition and response-size limits.
- Unit-test MCP initialization, tool listing, successful calls, invalid arguments and upstream errors.
- Run syntax checks and tests in GitHub Actions before deployment.
- Production validation requires a successful Vercel build, health response and representative MCP tool calls.
