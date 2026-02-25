# @aegis-protocol/mcp

MCP (Model Context Protocol) server for Aegis Protocol — gives AI agents the ability to check trust before acting.

Install it in Claude Desktop, Cursor, or any MCP-compatible host in minutes.

## Tools

| Tool | Description |
|------|-------------|
| `trust_query` | Full trust report: score, risk level, signals, and evidence |
| `should_proceed` | Binary go/no-go check with reasoning |
| `trust_explain` | Narrative explanation of why a subject has its trust rating |

## Quick Install (Claude Desktop)

**1. Clone and build:**
```bash
git clone https://github.com/tankcdr/aegis.git
cd aegis
pnpm install
pnpm -r build
```

**2. Add to Claude Desktop config** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "aegis": {
      "command": "node",
      "args": ["/path/to/aegis/packages/mcp/dist/index.js"],
      "env": {
        "GITHUB_TOKEN": "ghp_your_token_here"
      }
    }
  }
}
```

**3. Restart Claude Desktop.** Three new tools appear automatically.

## Subject Format

Use `namespace:id` format:

| Subject | Meaning |
|---------|---------|
| `github:tankcdr` | GitHub user |
| `github:tankcdr/aegis` | GitHub repository |
| `tankcdr/aegis` | Shorthand — defaults to `github` namespace |

## Example Prompts

> "Before I run this, check if `github:some-user/some-script` is trustworthy."

> "Should I install `github:modelcontextprotocol/servers`? Check trust first with action install."

> "Explain why `github:tankcdr/aegis` has its trust rating."

> "Check trust for `openai/openai-node` — I'm about to run it."

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKEN` | GitHub personal access token. Increases rate limit from 60 to 5,000 req/hr. Optional but recommended. |

## How It Works

Each trust query runs through the Aegis 7-step pipeline:

1. **Identity resolution** — parse subject into canonical namespace:id
2. **Signal dispatch** — fan out to all eligible providers in parallel
3. **Fraud detection** — lightweight anomaly detection
4. **Subjective Logic fusion** — cumulative belief fusion (Jøsang, 2001)
5. **Ev-Trust adjustment** — λ=0.15 evolutionary stability penalty on conflicting signals
6. **Risk mapping** — score → risk level → recommendation
7. **Cache** — results cached in-memory (TTL: 5 min default)

## License

Apache 2.0
