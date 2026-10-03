# Project rules

## Implementation

- Use TypeScript for the server and agent core.

## Code clarity

- Do not add code comments, including inline, block, or documentation comments.
- Express meaning through strong types, precise names, simple control flow, and focused tests. Simplify confusing code instead of explaining it with comments.
- Keep necessary rationale that code cannot express in focused documentation outside source files, not in README decision logs.
- If a tool or dependency requires a code comment, ask before making an exception.

## Documentation

- Keep READMEs simple, stable, and written for humans: purpose, usage, and settled architecture.
- Do not put project status, progress updates, open questions, decision discussions, or decision history in README files.
- Keep goals and constraints in `INTENT.md`. Keep temporary research and decision-making notes in gitignored `tmp/`.
- When a decision is settled, update the relevant documentation to describe the result, not the discussion that led to it.
- Describe planned capabilities as plans; do not imply they already work.
