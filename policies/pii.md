# Policy: PII handling

**Status:** v1.1 — advisory at the prompt level **and** enforced by `hooks/scripts/policy-check.sh` (`PreToolUse` hook). The hook applies the heuristic regex in Appendix A; catalog truth still wins at the agent level.

This policy is **read by the manager and every agent** before any task that touches data. Agents must refuse to violate it; the manager must refuse to dispatch tasks that violate it.

## Definitions

- **PII** — data that identifies a real person directly or indirectly. Includes (non-exhaustive): full name, email, phone, postal address, IP address, government IDs, payment card numbers, biometric ids, exact birth date, precise geolocation, account credentials.
- **Sensitive non-PII** — health, financial, location, or behavioral data that, while not directly identifying, can be re-identified or causes harm if leaked.

A column / field is treated as PII if **any** of:

1. The catalog tags it (`pii: true`, `sensitivity: high`, etc.).
2. The column name matches a heuristic regex (see Appendix A).
3. The user marks it via `preferences.pii_strictness = "strict"` and the column appears in the configured strict-list.

## Hard rules

1. **No raw PII into model context.** Bounded results returned to the manager / agents must mask, hash, or omit PII columns. Aggregations are preferred (`COUNT`, `AVG`, bucketed distributions).
2. **No PII in artifacts.** Saved queries, reports, and visualization specs must not include unmasked PII values. Replace literals with placeholders or aggregate predicates.
3. **Refuse on explicit request unless overridden.** If a user explicitly asks for raw PII, the manager confirms in writing (in chat), records the consent in `findings[].answer`, and proceeds only if `preferences.pii_strictness != "strict"`.
4. **Catalog flags are authoritative.** When the catalog marks a column as PII, the manager treats that flag as truth — `query` will reject queries selecting that column unmasked.
5. **Never log PII.** Manager debug output, hook logs, and error messages must not echo raw PII.

## Agent-level enforcement

- `query` — checks projected columns against PII flags from `domain-specialist` (or column name heuristics). If a flagged column is selected without masking, returns `pii_violation` instead of running.
- `narrative` — must not paste raw row values verbatim if those rows reference PII columns; uses summary statistics or row counts.
- `discovery` — when profiling, samples PII columns only as **type info / null rate / cardinality**. No raw values.
- `domain-specialist` — surfaces PII flags from catalog into its brief (`### Caveats: PII columns: …`).
- `methods` — operates on bounded results that have already passed `query`'s gate; does not re-fetch raw PII.
- `critic` — flags any answer that appears to leak raw PII as `reject`.
- `memory` — never persists raw PII into `term_cache`, `concept_mapping`, or `findings`.

## Strictness levels (`preferences.pii_strictness`)

| Level | Behavior | Hook enforcement |
|------|----------|-------------------|
| `strict` | All PII access requires explicit per-question user consent. No overrides for narrative quoting. | Hook denies any heuristic match; no escape hatch. |
| `default` | Aggregations and masked samples allowed without prompting. Raw PII requires explicit consent. | Hook denies bare projections; recommends masking/aggregating wrappers. |
| `lenient` | Raw PII allowed when user is sole reader; still no PII in committed artifacts. | Hook PII check is skipped; allowlist + write-class still enforced. |

Default workspace preference is `default`.

## Appendix A — heuristic column-name patterns

Names matching any of these (case-insensitive, word-boundary) are treated as PII unless the catalog says otherwise:

- `email`, `e_mail`, `mail`
- `phone`, `mobile`, `tel`
- `ssn`, `nin`, `national_id`, `passport`, `aadhaar`, `pan`
- `dob`, `date_of_birth`, `birthdate`
- `addr`, `address`, `street`, `postcode`, `zip`
- `ip`, `ip_addr`, `client_ip`
- `card`, `pan_number`, `cvv`, `iban`, `account_no`
- `password`, `pwd`, `secret`, `token`, `api_key`

These are heuristics — catalog truth wins.
