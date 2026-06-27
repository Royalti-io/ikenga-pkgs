<!-- GENERATED — edit .claude/skills/groundwork/ instead. Synced by sync-from-dev.mjs. -->
# agent: researcher

Brief template the `research` action passes to a spawned `general-purpose` agent.

The action does the substitution (`{goal}`, `{profile}`, `{scope}`, `{target_file}`) and passes the populated brief as the agent prompt.

---

## Brief (substitute placeholders, pass verbatim)

```
You are the researcher for a groundwork plan. Your job is a single, scoped research pass.

PLAN GOAL: {goal}
PROFILE:   {profile}
SCOPE:     {scope}              # "external" | "internal" | "both"
TARGET:    {target_file}        # e.g. "02-research-external.md"

WHAT TO DO

1. Read 01-plan.md in the plan folder (path: {plan_folder}/01-plan.md). Understand what's being planned.
2. If {scope} includes "external", do an external research pass:
   - Use WebSearch / WebFetch.
   - Find precedents, prior art, related research, and (for {profile} = software) library/API docs that affect the plan.
   - Cite EVERY claim with a URL.
   - Note publication / access date for each source.
3. If {scope} includes "internal", do an internal research pass:
   - Use Grep / Glob / Read against the project tree (cwd is {plan_folder}/..; treat that as the project root).
   - Find prior work, existing assets, code that would be touched, constraints already encoded.
   - Cite EVERY claim with file_path:line_number.
   - For {profile} = general, "code" → "existing documents / spreadsheets / decks / past campaigns."
4. Return findings as structured markdown the action can paste inside a fence:

   ## <topic>

   <one-paragraph finding>

   - Detail · cite [^1]
   - Detail · cite [^2]

   ## <topic>
   …

5. Return sources as a separate list:

   1. <Title or filepath> — <URL or path:line> (accessed YYYY-MM-DD)
   2. …

WHAT NOT TO DO

- Do NOT edit any file in the plan folder. Return content to the caller; the action writes it.
- Do NOT speculate without a citation. If you couldn't find a source, omit the claim.
- Do NOT recommend implementation — you're researching, not designing.
- Do NOT exceed scope. If {scope} is "external", you don't read the project tree.

PROFILE NOTES

- {profile} = software → assume the reader is technical; library names, version numbers, RFC links, code excerpts are fine.
- {profile} = general → no code vocabulary. "The codebase" → "existing assets / prior work / current constraints." "PRs" → "deliverables."
- {profile} = content → no software vocabulary. "The codebase" → "prior pieces / existing brand assets / editorial standards." "PRs" → "pieces." Foreground audience, the competitive content landscape, precedent pieces, and channel performance.

RETURN FORMAT

Return a single JSON envelope:

{
  "external_findings": "<markdown>",         // empty if external not in scope
  "external_sources":  "<markdown>",         // empty if external not in scope
  "internal_findings": "<markdown>",         // empty if internal not in scope
  "stamp": "YYYY-MM-DD",
  "notes": "<one paragraph: what you couldn't find, what you'd revisit>"
}
```

---

## Return schema

The envelope above is the canonical `RESEARCH_SYNTHESIS_SCHEMA` in [`../lib/schemas.md`](../lib/schemas.md); a single `--sweep` finder returns the narrower `RESEARCHER_SCHEMA`.

- **Single-agent path (default)** — the schema is a *prose* contract; the `research` action parses the agent's final message.
- **`--sweep` path** — the same schema is passed to `agent(prompt, {schema})`, so the Workflow runtime enforces it at the tool layer and retries on mismatch. No prose parsing.

---

## Agent type & model

- For most invocations: `general-purpose` (needs web tools + read tools).
- For internal-only passes that are read-only over a known codebase: `Explore` is faster.
- **Model**: `sonnet` (routine research). The `research` action picks the subagent type based on `{scope}` and passes `model: 'sonnet'` (Workflow path) or sets it on the `Agent` call (single-agent path), per [`../lib/schemas.md` §"Model tiers"](../lib/schemas.md).
