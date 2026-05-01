# WAN Composer — project scope

This document summarizes product scope for the WAN Composer desktop-style web app: Forge Neo orchestration, project timelines, segments, and run history, **plus** a planned local-only LLM layer (design draft).

Detailed LLM specification: **[`docs/specs/local-llm-integration.md`](specs/local-llm-integration.md)** (v2.0).

---

## Product slice (today’s codebase)

The application is Next.js-based with:

- **Profiles** persisted under the data dir (`profiles.json`; see `src/lib/app-config/profiles.ts` and `COMPOSER_DATA_DIR` / `getDataDir()` in `src/lib/env.ts`).
- **Forge** connectivity per profile (Forge API base URL, timeouts).
- **Projects, segments, runs** with API routes under `src/app/api/` and orchestration in `src/lib/orchestrator/`.

Anything not wired in those layers is aspirational until implemented.

---

## LLM integration (planned — not implemented yet)

Design principles from the detailed spec:

- **Local-only:** KoboldCpp is the canonical backend via OpenAI-compatible `POST /v1/chat/completions` and discovery/health endpoints. No cloud fallback, API keys, or provider routing for cost tiers.
- **Opt-in:** `enabled` in LLM config; full manual workflows when disabled or unreachable.
- **No silent degradation:** Throws `LLMUnavailableError`; UI explains how to restore service.
- **User-in-the-loop:** All LLM outputs are reviewable/editable before they commit to project state.

### Alignment notes (implementation backlog)

When this is built:

| Spec item | Repo reality to reconcile |
|-----------|---------------------------|
| Config path `~/wan-composer/config/llm.json` | Today data lives under `~/.local/share/composer` (or `COMPOSER_DATA_DIR`). Choose one: extend profiles with `llm`, add `config/llm.json` beside `profiles.json`, or env-driven `COMPOSER_LLM_CONFIG`. |
| `~/wan-composer/llm/` for prompts | Same convention decision: subdirectory under shared data dir vs separate home-tree path (`WAN_COMPOSER_*` env). |
| Pause-gate continuation, `segment.pause_for_review` | Map to orchestrator pause/resume and run-store once behavior is finalized in core orchestrator. |
| Run options `llm` fields | Extend `RunOptions` / schemas in `src/lib/schemas/run.ts` alongside existing core fields. |
| Cached suggestions in `runs/.../llm_cache/` | Align layout with existing run persistence in `run-store`/project-store. |

### Phased delivery (from spec §8 — execution order)

1. **Foundation:** `KoboldLLM` (or equivalent single module), connection state, Settings + top-bar status, **prompt polish only** to validate plumbing.
2. **Core writing:** Pause-gate continuations, shared `wan_prompting_guide.md`, few-shots, system prompt editing in Settings.
3. **Script generation:** Wizard with streaming JSON parsing, regeneration flows, variations, negative-prompt suggester.
4. **Power features:** Style transfer-style flows, director notes, templates, usage/`failed_json_parse` stats.
5. **Long-term:** Embeddings/search, dialogue+TTS bridge, multi-Kobold routing, conversational project tooling.

Later items in **§7 Cool extensions** are explicitly post–v1 backlog; keep issue tracking scoped so core shipping is not blocked.

### Testing stance (planned)

- Zod-validated outputs per task; `MockKoboldServer`-style mocks for CI.
- Optional slow/integration tests gated on a running Kobold (manual or nightly), not required on every commit.
- Regression harness for structural expectations on scripted generator inputs when prompts change.

---

## Open questions from spec §10

Captured for future decisions: bundled vs lazy few-shot data, sharing one Kobold instance across users (out of scope for single-user v1), GBNF vs retry loops after measuring JSON failure rates, vision-capable continuation (v2+).

---

## Document map

| Document | Contents |
|---------|----------|
| `docs/specs/local-llm-integration.md` | Full Local LLM Integration Spec v2.0 — API surfaces, prompts, UI, orchestrator interplay, appendix reference calls. |

This file is intentionally short; the authoritative LLM behaviors and phased detail live in the spec.
