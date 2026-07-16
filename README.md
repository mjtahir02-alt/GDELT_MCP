# GDELT MCP

A remote, read-only Model Context Protocol server for global media intelligence using the public **GDELT DOC 2.0 API**.

The server requires no GDELT API key and is deployed on Vercel.

## Tools

| Tool | Purpose |
|---|---|
| `search_articles` | Search multilingual global news coverage and return structured article results |
| `get_coverage_timeline` | Track normalized media attention or raw matching article counts over time |
| `get_tone_timeline` | Track the average tone of matching coverage over time |
| `get_source_country_timeline` | Compare attention across countries where publishing outlets are based |

The documented GDELT GEO API currently returns HTTP 404, so geographic mapping is deliberately not exposed as a tool.

## Important interpretation note

GDELT is a large-scale automated media-monitoring system. Its translation and tone analysis can contain errors. Results should be interpreted as **signals about news coverage**, not as verified facts or direct measurements of real-world events.

## Reliability controls

GDELT currently asks API users to keep requests at least five seconds apart. This server therefore:

- serializes outbound GDELT requests at least 5.5 seconds apart per warm instance;
- retries HTTP 429 once after at least six seconds;
- respects a longer `Retry-After` header when supplied;
- caches successful identical requests for five minutes; and
- limits response size and MCP request volume.

Because Vercel uses shared serverless egress, GDELT may still occasionally return HTTP 429 during periods of heavy traffic. The MCP returns that error transparently instead of fabricating data.

## Architecture

- Plain Node.js with no runtime dependencies
- Vercel serverless functions in the Dubai region
- Stateless MCP Streamable HTTP
- Primary MCP endpoint: `/mcp`
- Alternate MCP endpoint: `/api/mcp`
- Health endpoint: `/health`
- Optional deep DOC check: `/health?deep=1`

## Local validation

```bash
npm install
npm test
npm run build
```

## Local development with Vercel CLI

```bash
npm install -g vercel
vercel dev
```

Then connect an MCP client to:

```text
http://localhost:3000/mcp
```

## Deploy to Vercel

1. Import this repository into Vercel.
2. No environment variables are required.
3. Deploy and open `/health`.
4. Connect the MCP client to `https://<your-domain>/mcp`.

## Optional environment variables

| Variable | Purpose |
|---|---|
| `GDELT_DOC_API_BASE` | Override the public DOC endpoint for testing |
| `MCP_ALLOWED_ORIGINS` | Comma-separated allowed browser origins |
| `MCP_RATE_LIMIT_PER_MINUTE` | MCP requests per IP per minute; defaults to 30 |

No secrets should be committed.

## Example prompts

- “Search global coverage of sovereign AI published in the last 24 hours.”
- “Compare how much attention different publishing countries are giving to data-centre power constraints.”
- “Show the seven-day coverage-volume and tone trends for NVIDIA export restrictions.”
- “Find the latest Arabic-language coverage of AI regulation.”

## GDELT query examples

The `query` field supports GDELT syntax, including:

```text
"artificial intelligence"
(climate OR flooding OR drought)
near20:"Trump Putin"
theme:ECON_INFLATION
tone<-5
```

Structured tool arguments can also add source-country, language, exact-domain, theme and tone filters.

## MCP client configuration

```json
{
  "mcpServers": {
    "gdelt": {
      "url": "https://<your-domain>/mcp"
    }
  }
}
```

## License

MIT
