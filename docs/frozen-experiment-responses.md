# Frozen experiment explanations

During the controlled experiment, `POST /eval/explanation` is database-only.
It cannot call the configured LLM provider and it never falls back to live
generation. Requests outside the prepared conditions fail closed.

The IDE sidebar restricts profile mode to exactly one profile at a time. In
profile mode, its AI explanation switch is permanently selected and disabled,
and the assessment runner always requests the frozen explanation after metric
evaluation. In custom metric mode, the switch is unselected and disabled, no
explanation request is made, and any non-empty combination of `m1` through
`m14` is allowed. Legacy workspace or project selections containing several
profiles are reduced to the first profile shown in the sidebar; extension-host
validation also rejects a submitted multi-profile message.

## Storage and lookup

`frozen_explanation` stores the existing explanation response DTO in a JSONB
column. Its unique lookup key is:

```text
(project_id, assessed_target, profile_id, direction)
```

The externally stable project identity is the real project UUID from
`thesis-evaluation-projects/.uiqlab.json`:

```text
5d66b2c8-0049-49f3-9e45-4f89349fe217
```

Alpha and Beta are route families in that same project, rather than separate
database projects. The route component of the key distinguishes the two
families and conditions; profile plus direction prevents the two Beta visual
clutter responses at `/v/l5q9au` from colliding.

## Migrate and seed

Application startup creates the table and idempotently upserts all 12 rows. To
run the same operation explicitly in the Compose service:

```bash
docker compose exec orchestrator python seed_frozen_responses.py
```

For a host-side development database exposed on port 5433:

```bash
POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5433 \
  apps/orchestrator/.venv/bin/python apps/orchestrator/seed_frozen_responses.py
```

Repeated runs update the same rows through the unique key and cannot create
duplicates.

## Restoring live generation after the experiment

Restoration intentionally requires a source-code change:

1. In `apps/orchestrator/main.py`, remove the active frozen-only body of
   `explain_assessment()`.
2. Uncomment the provider configuration and the complete preserved request,
   DTO-assembly, and error-handling block between the
   `BEGIN: LIVE LLM DISABLED FOR CONTROLLED EXPERIMENT` and matching `END`
   comments.
3. Uncomment the provider environment entries in `docker-compose.yml`.
4. Remove `projectKey` from `ExplainAssessmentInput` and
   `AssessmentExplanationContext` only if the restored API should return to its
   previous request contract.
5. Re-enable provider configuration in deployment as appropriate, rebuild the
   orchestrator, and replace the frozen-only tests with live-integration tests.

No feature flag, environment variable, query parameter, or runtime control can
perform this restoration.
