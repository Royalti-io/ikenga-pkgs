---
'@ikenga/pkg-sales': minor
'@ikenga/pkg-research': minor
'@ikenga/pkg-content': minor
'@ikenga/pkg-strategy': minor
---

Operator identity now comes from hostContext.operator instead of a hardcoded handle. "Mine" filters, owner fallbacks, and avatar initials derive from the shell-provided operator; when absent, dispatch ux_mode fails safe to 'confirm' (never 'silent' for an unknown operator).
