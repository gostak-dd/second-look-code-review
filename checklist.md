# AI-code review checklist

Things coding agents get wrong again and again. Each check has an id (used in `guide.json` findings), what to look for, and what to suggest. Fork this file: delete what doesn't apply to your stack and add the failures you've actually seen in production. Your own list beats a generic one.

Only report a check when the code in the diff actually does it.

---

## LLM calls

### `unbounded-output`
**Look for:** model calls with no output token limit, structured-output / JSON-mode calls with no guard against runaway whitespace, timeouts that only fire when the stream goes idle.
**Why:** a model can stream spaces into a JSON field until it hits the token limit. Data is still arriving, so idle timeouts never fire, and you pay for every token.
**Suggest:** a default `max_tokens` above the largest real response, a total-duration deadline, and for streamed structured output, abort when you see a long run of whitespace (e.g. 4,000+ chars).

### `stacked-retries`
**Look for:** a retry loop around a call whose SDK already retries, retries around a fallback chain, or retries at more than one layer of the call stack.
**Why:** retries multiply. Three layers of three attempts is 27 calls for one request.
**Suggest:** pick one layer to own retries, disable the others (e.g. SDK `max_retries=0`), and cap total attempts.

### `cache-breaking-prompt`
**Look for:** dynamic values (dates, user names, IDs, language, counts) placed near the top of a system prompt; tools listed in a non-deterministic order; prompt text rebuilt with changing whitespace.
**Why:** prefix caching only works when the start of the prompt is byte-for-byte identical. One changing word early on disables caching for everything after it.
**Suggest:** fixed instructions first, then conversation context, then dynamic values at the end. Sort tool definitions.

### `unbounded-context`
**Look for:** tool results, file contents or search results appended to agent context without a size cap; whole documents passed when a slice would do.
**Why:** in an agent loop, everything in context is re-sent on every turn after it.
**Suggest:** cap tool output, write the rest to a file the agent can page through, and replace old tool results with short references.

### `wrong-model-tier`
**Look for:** the largest model used for classification, extraction, routing or validation; a newly hardcoded model string where the codebase has a model config.
**Why:** a small model or plain code does these jobs at a fraction of the cost.
**Suggest:** the cheaper tier, behind an eval, or a lookup in code if the task is deterministic.

### `prompt-change-no-eval`
**Look for:** changes to prompts, model names or temperature with no change to evals or tests.
**Why:** prompt changes are behavior changes, and nothing will catch a regression.
**Suggest:** run the eval set, or add the cases this change is meant to fix.

---

## Correctness

### `swallowed-error`
**Look for:** `catch` / `except` blocks that log and continue, return `null` / empty / a default, or catch everything (`except Exception`, `catch (e) {}`).
**Why:** the failure becomes a wrong result somewhere else, much harder to trace.
**Suggest:** catch the specific error you can handle; let the rest propagate.

### `silent-fallback`
**Look for:** `?? defaultValue`, `|| []`, `.get(key, default)` on values that should always exist; fallbacks to a different model or provider with no log or metric.
**Why:** hides bugs and config mistakes. The system "works" while doing the wrong thing.
**Suggest:** fail loudly on missing required values; log and count any fallback that does fire.

### `trusts-client-input`
**Look for:** IDs, file paths, roles, prices or user IDs taken from the request body and used without checking the caller owns or may access them.
**Why:** anyone can send any ID.
**Suggest:** derive ownership server-side, or check it explicitly before use.

### `duplicate-helper`
**Look for:** a new function that does what an existing util already does (formatting, parsing, fetching, retrying).
**Why:** agents rarely search the codebase before writing a helper. Two versions drift apart.
**Suggest:** point to the existing helper by path.

### `repeated-work`
**Look for:** clients, connections or secrets created per request; the same file or document parsed or embedded more than once; work inside a loop that doesn't depend on the loop variable.
**Why:** latency and cost for nothing.
**Suggest:** create once and reuse; cache parsed results by content hash.

### `migration-risk`
**Look for:** schema changes without a backfill, new required fields on existing data, renames without a transition period, destructive migrations.
**Why:** the code works on a fresh database and breaks on the real one.
**Suggest:** make the field optional first, backfill, then tighten.

---

## Tests

### `tests-test-mocks`
**Look for:** tests where the mock returns the expected value and the assertion checks that value; tests with no meaningful assertion; snapshots of large blobs.
**Why:** they pass whatever the code does.
**Suggest:** assert on behavior the code under test produced, or test one level lower without the mock.

### `missing-failure-test`
**Look for:** new error paths, guards or validation with tests only for the happy path.
**Why:** the guard is the part most likely to be wrong, and it's untested.
**Suggest:** one test per new failure path.

---

## Leftovers

### `leftover-debug`
**Look for:** `console.log`, `print`, commented-out code, `TODO` without an owner, temporary flags left on.
**Suggest:** remove, or turn into proper logging.
