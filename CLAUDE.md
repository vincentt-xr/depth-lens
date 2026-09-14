# CLAUDE.md

Claude Code reads this file automatically. The full agent contract for this project
lives in **[AGENTS.md](./AGENTS.md)** — read it first. It covers the dev loop, the
`vincentt` platform commands, what to edit vs. leave alone, and how assets work.

The SDK API reference — every component, hook, and prop you may use — is in
**[GROUNDING.md](./GROUNDING.md)**. Read it before writing a scene, and use only the
props it documents.

Drive the platform from your shell with the **`vincentt` CLI**, invoked as
`npx vincentt <verb>` (`npx vincentt preview | publish | logs | feedback --wait`) —
it resolves to the project's local devDep, so no global install is needed. On first
use the developer approves a browser sign-in; there's no separate login step and no
MCP registration.
