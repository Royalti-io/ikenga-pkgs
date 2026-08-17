---
'@ikenga/mcp-iyke': patch
---

Report the real package version in the MCP server identity.

The `version` in the `Server()` handshake was a hardcoded `'0.1.0'` literal that
never moved while the package shipped 0.2.1, so every MCP client asking who we
are was told a build from three releases earlier. It now reads `version` from
`package.json` at startup, which removes the literal that drifted rather than
just correcting it once.
