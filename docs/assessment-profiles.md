# Assessment profiles

An assessment profile groups related metrics and records the intended direction
of change. Directions affect comparisons and quality gates, not metric
execution.

## Using profiles in the IDE

The **UITend Assessment** sidebar has two modes:

- **Profiles**: select one or more profiles and a direction for each.
  `general-review` is excluded because it is equivalent to all metrics.
- **Custom metrics**: select any combination of `m1` through `m14`.

Profile selections are resolved to metric IDs and duplicates are removed.
Switching modes clears the inactive selection. Sidebar changes apply only to
the interactive run and do not modify `.uitend.json`.

When a compatible baseline exists, the history comparison shows whether each
profile goal was achieved and which material metric changes aligned with,
opposed, or did not significantly affect its direction. Custom runs keep the
metric-by-metric comparison without the profile dashboard.

If **Use LLM explanation** is enabled, UITend adds advisory guidance above the
raw results. The optional **Allow LLM to use source code (Demo)** setting may
share up to 10 relevant frontend files, limited to 24 KiB per file and 100 KiB
total. It is off by default. See
[LLM-based assessment explanations](llm-explanation-integration.md).

## Configuration

For multi-page CI assessments, configure `ci.pages`. Each page has its own
profiles and quality gate:

```json
{
  "projectKey": "123e4567-e89b-12d3-a456-426614174000",
  "name": "example-web-app",
  "ci": {
    "branches": ["main", "feature/ui-*"],
    "baselineBranch": "main",
    "pages": [
      {
        "path": "/checkout",
        "profiles": [
          { "id": "accessibility", "direction": "fewer-detected-violations" },
          { "id": "text-amount", "direction": "fewer-words" }
        ],
        "qualityGate": { "mode": "enforce" }
      }
    ]
  }
}
```

For a single-page CI run or the IDE default, use a top-level `assessment`:

```json
{
  "assessment": {
    "mode": "profiles",
    "profiles": [
      { "id": "visual-complexity", "direction": "reduce-complexity" }
    ]
  }
}
```

Manual selection uses custom mode:

```json
{
  "assessment": {
    "mode": "custom",
    "metrics": ["m8", "m10", "m13", "m14"]
  }
}
```

The legacy `ci.metrics` field remains supported for single-page custom runs.
Do not combine profile and manual metric selection.

## Available profiles

| Profile ID | Allowed directions | Metrics |
| --- | --- | --- |
| `general-review` | `observe` | All metrics, `m1`–`m14` |
| `visual-complexity` | `reduce-complexity`, `increase-complexity`, `preserve`, `observe` | `m9`, `m10`, `m11` |
| `screen-whitespace` | `more-whitespace`, `less-whitespace`, `preserve`, `observe` | `m5` |
| `text-amount` | `more-words`, `fewer-words`, `preserve`, `observe` | `m8` |
| `colorfulness` | `more-colorful`, `less-colorful`, `preserve`, `observe` | `m3` |
| `accessibility` | `fewer-detected-violations`, `preserve`, `observe` | `m13` |

`preserve` treats material movement in either direction as opposed.
`observe` reports movement without creating a pass/fail goal. The
accessibility profile covers automatically detected violations, not overall
accessibility.

## Comparison and quality gates

UITend compares each profile's primary scalar metrics with the latest
compatible baseline. Outcomes are `aligned`, `opposed`, `mixed`,
`unchanged`, or `not-comparable`. Fixed materiality thresholds prevent small
changes from affecting the outcome. Visual and structured metrics remain in
the report but do not determine a direction.

Quality-gate modes behave as follows:

| Mode | Aligned, unchanged, or not comparable | Mixed | Opposed |
| --- | --- | --- | --- |
| `report` | Pass | Pass | Pass |
| `warn` | Pass | Warning | Warning |
| `enforce` | Pass | Warning | Fail |

A first run normally passes and establishes a baseline. Set
`qualityGate.requireBaseline` to `true` to fail when no compatible baseline
exists. LLM explanations never affect the gate.

See [CI integration](ci-integration.md) for exit codes, variables, and pipeline
examples.

## Validation

UITend rejects unknown or repeated profiles, unsupported directions, invalid
metric IDs, duplicate page paths, empty selections, and configurations that
combine profiles with manual metrics. Each multi-page entry must include a
route path, at least one profile, and `qualityGate.mode`.
