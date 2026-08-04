---
"@ikenga/skill-groundwork": minor
---

Make a research pass survive a truncated session.

The `research` action folds findings into the fenced regions exactly once, at the
end of the pass. That is correct for the `write-region` hash contract, but on its
own it means a session that dies mid-pass loses every search the agent already
ran, and the next run restarts from nothing. Web research is the most expensive
thing groundwork does and the easiest to lose.

The researcher now keeps a journal: it writes the file *before* its first search
and appends after every one, with a checkpoint summary every third search. Under
`--sweep`, each angle gets its own journal so concurrent finders cannot clobber
one another.

The journal's existence is the signal. A journal present when the action starts
means the previous pass never folded, so the action now offers to fold it as-is,
resume from it, or discard — rather than silently overwriting it. It is deleted
only after the fold has stamped successfully.

**New on-disk side effect.** A research pass now creates
`<plan_folder>/.research-journal-<scope>.md` in your plan folder, and leaves it
there if the pass is interrupted. It is a dotfile that sits outside every
`groundwork:auto` fence, so it is never hashed, stamped, or written into your
spine documents — but if you track plan folders in git, add
`.research-journal-*.md` to your ignore rules. The journal is transient by design
and should not land in a commit.

Also fixes two long-standing gaps in the researcher brief's declared substitution
list: `{plan_folder}` has always been required by the brief but was never listed,
and `{stamp}` joins it. The action substitutes `{stamp}` because a spawned agent
cannot reliably read the clock.
