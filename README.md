# GDELT MCP

A remote, read-only Model Context Protocol server for global news intelligence using the public **GDELT DOC 2.0** and **GEO 2.0** APIs.

The server requires no GDELT API key and is designed for deployment to Vercel.

## Tools

| Tool | Purpose |
|---|---|
| `search_articles` | Search multilingual global news coverage and return structured article results |
| `get_coverage_timeline` | Track normalized media attention or raw matching article counts over time |
| `get_tone_timeline` | Track the average tone of matching coverage over time |
| `get_source_country_timeline` | Compare attention across countries where publishing outlets are based |
| `map_news_locations` | Return GeoJSON locations mentioned in matching news coverage |

All tools are read-only and declared as `noauth` for MCP clients.

## Important interpretation note

GDELT is a large-scale automated media-monitoring system. Its translation, tone, image analysis and geocoding can contain errors. Results should be interpreted as **signals about news coverage**, not as verified facts or direct measurements of real-world events.

## Architecture

- Plain Node.js with no runtime dependencies
- Vercel serverless functions
- Stateless MCP Streamable HTTP
- Primary MCP endpoint: `/mcp`
- Alternate MCP endpoint: `/api/mcp`
- Health endpoint: `/health`
- Optional deep upstream check: `/health?deep=1`

## Local validation

```bash
npm install
npm run build
```

The build command runs syntax checks and all unit tests.

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
| `GDELT_DOC_API_BASE` | Override the public DOC API endpoint for testing |
| `GDELT_GEO_API_BASE` | Override the public GEO API endpoint for testing |
| `MCP_ALLOWED_ORIGINS` | Comma-separated allowed browser origins |
| `MCP_RATE_LIMIT_PER_MINUTE` | Per-instance requests per IP per minute; defaults to 30 |

No secrets should be committed.

## Example prompts

- “Search global coverage of sovereign AI published in the last 24 hours.”
- “Compare how much attention UAE and UK outlets are giving to data-centre power constraints.”
- “Show the seven-day coverage-volume and tone trends for NVIDIA export restrictions.”
- “Map the cities mentioned in flooding coverage during the last 12 hours.”

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
