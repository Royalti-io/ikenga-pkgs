---
"@ikenga/mcp-iyke": patch
"@ikenga/mcp-browser": patch
"@ikenga/mcp-devin": patch
---

Move MCP server identities to the `dev.ikenga/*` namespace, authenticated
against the `ikenga.dev` domain rather than a GitHub org name. The previous
`io.github.Royalti-io/*` identities were invalidated by the move to the
`ikenga-hq` org; a domain-based namespace cannot be broken the same way again.
