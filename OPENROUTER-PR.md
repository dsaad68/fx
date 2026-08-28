# Add OpenRouter as a model provider

> Draft write-up for an upstream pull request against `vercel-labs/fx`.
> Kept here as a note; not part of the shipped feature. The PR it was written
> for was opened as a draft and then closed, so this is the surviving record of
> the rationale.

## Summary

Adds **OpenRouter** as a model provider, alongside Vercel AI Gateway, Codex, and Grok.

All three existing routes need either Vercel billing or a paid consumer subscription, and every base-URL override is restricted to loopback HTTP, so there is no way to point fx at another endpoint. OpenRouter adds ~400 models behind a single API key, including a set that cost nothing to run — so a user with no Vercel billing and no ChatGPT or Grok subscription can run fx for free.

## Design notes

**A new wire format.** OpenRouter speaks OpenAI **Chat Completions**, which neither existing protocol module covers (`vercel_protocol.zig` is Vercel v3, `responses_protocol.zig` is the OpenAI Responses API). `chat_completions_protocol.zig` carries no vendor identity so any future OpenAI-compatible route can share it. It accumulates streamed tool calls by their `index` field and skips SSE comment lines, which OpenRouter emits as `: OPENROUTER PROCESSING` keep-alives mid-stream — feeding one to a JSON parser aborts an otherwise healthy stream.

**API key, no OAuth.** Auth follows the existing `ai_gateway_api_key` shape via `OPENROUTER_API_KEY`. There is no stored session, so `fx logout openrouter` says so rather than falling through to the Vercel logout.

**Tool-capable models only.** fx calls tools every turn, so the catalog fetches with `?supported_parameters=tools`; a model that cannot call tools breaks on the first step.

**Free models are surfaced deliberately.** Identified by published pricing, sorted first, and shown four ways: a `Free` fact in the `/model` menu, a marker in `fx models`, a `free` field in its JSON, and a `--free` filter. `is_free` is authoritative; the `:free` id suffix is a display convenience for surfaces that only carry id strings, and a fixture test pins the two together.

**Exact usage.** OpenRouter reports token counts and credit cost inline on the terminal chunk, so no deferred reconciliation is needed. The 402, 429, and 503 responses carry plain-language detail, since a negative balance blocks even free models and free-tier requests are capped at 20/min and 50/day.

**Ordering stays provider-owned.** `compareModelCatalogEntries` and `projectPickerModelCatalog` encode Vercel-specific product policy and are gateway-only, so OpenRouter is deliberately not routed through them.

## Commits

1. **Add OpenRouter as a model provider** — the protocol module, transport, catalog, permission reviewer, and `ProviderId` plumbing.
2. **Offer OpenRouter in the interactive setup hub** — `/setup` enumerated a hardcoded three providers, so it was unreachable from the TUI.
3. **Reach OpenRouter from every provider-aware surface** — a sweep for that same defect class found it in ACP config options, `fx status`/`doctor`, the tools-disabled profile, and credential guidance.

Where a hand-maintained list caused a miss, it was replaced with something the compiler or a test enforces: `isGatewaySource`, `missingCredentialMessage`, and a test that walks `std.meta.tags(ProviderId)` to assert every provider is reachable from the setup picker.

## Testing

- **Live API:** verified against real OpenRouter — a free model answering, a tool call executing, usage accounting reported.
- **Unit:** 8743 passing. New tests cover the reducer (including keep-alive comments, index-correlated tool-call fragments, mid-stream errors over HTTP 200, resource ceilings), catalog parsing and free-first ordering, request serialization, and the setup picker.
- **E2E:** `tests/e2e/openrouter-stream.test.ts` — catalog filtering, free-first ordering, the `--free` filter, a streamed tool-call round trip, and the 402/429 paths. Classified in `corpus.json` as verification-only with a shard weight.
- **Interactive:** `/setup` → Model provider and Connections, `/model`, and ACP config options driven in a real terminal.

## Known gap

`FailureKind` has no payment-required variant, so a 402 maps to `forbidden` — correct non-retryable semantics, but it surfaces as "HTTP 403". The detail names the real status so the message cannot mislead. Happy to add a `payment_required` variant instead if you'd prefer it fixed at the enum.

## Note on scope

This is a fork-driven contribution and I recognize OpenRouter is a model router, so it overlaps with AI Gateway in a way that Codex and Grok do not. Opening as a draft to check appetite before polishing further — happy to close if it is not a direction you want.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
