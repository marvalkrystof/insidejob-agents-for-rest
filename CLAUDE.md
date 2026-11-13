# Domovník

- [FEATURES.md](FEATURES.md) is the single list of what Domovník does or could do, with priority and status. A commit that changes behaviour updates the matching rows in the same commit; a new idea goes in with priority `idea` and status `not built`. The format rules are at the top of that file.
- The vision, personas, research of the sources and the risks are in [daily-local-digest.md](daily-local-digest.md); open decisions and legal debts are in [LATER.md](LATER.md).
- Before committing, run `yarn typecheck` and `yarn check:features`; both must pass.
- After a change to the digest prompts or to what the LLM receives, run `yarn digest --dry-run --as-of=2026-11-16T06:30:00+01:00` and check every cited claim against `data/digest.json`.
- Featherless allows one LLM call at a time for the whole team (Kimi takes all 4 concurrency units of the plan): parallel digest or agent runs get HTTP 429.
- Never commit `.env`, `data/`, `fixtures/` or `.spikes/`: they hold keys or personal data.
