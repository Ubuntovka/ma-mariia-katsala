# Assessment profiles

UIQLab supports predefined assessment profiles in the repository-level
`.uiqlab.json` file. A profile selects a related group of metrics and records the
intended direction of the assessment. The direction is metadata only: it does
not currently affect metric execution or interpretation.

## Profile configuration

Set `assessment.mode` to `profiles` and provide one or more profile selections:

```json
{
  "projectKey": "123e4567-e89b-12d3-a456-426614174000",
  "name": "example-web-app",
  "assessment": {
    "mode": "profiles",
    "profiles": [
      {
        "id": "visual-complexity",
        "direction": "decrease"
      }
    ]
  },
  "ci": {
    "branches": ["main", "feature/ui-*"],
    "baselineBranch": "main"
  }
}
```

Each selection requires both an `id` and a valid `direction`. The selected
profiles are resolved to metric IDs before an assessment is submitted.

## Available profiles

| Profile ID | Allowed directions | Metrics |
| --- | --- | --- |
| `general-review` | `observe` | All metrics, `m1` through `m14` |
| `visual-complexity` | `decrease`, `increase`, `preserve`, `observe` | Edge density (`m9`), Feature congestion (`m10`), Subband entropy (`m11`), Shannon's information entropy (`m12`) |
| `layout-density` | `more-spacious`, `more-compact`, `preserve`, `observe` | White space proportion (`m5`), Feature congestion (`m10`), UIED segmentation (`m6`) |
| `content-density` | `decrease`, `increase`, `preserve`, `observe` | Word count (`m8`), White space proportion (`m5`), Feature congestion (`m10`) |
| `colour-expression` | `more-vivid`, `more-restrained`, `preserve`, `observe` | Colorfulness (`m3`), CIELab color average and standard deviation (`m4`) |
| `aesthetic-impression` | `increase`, `preserve`, `observe` | NIMA (`m14`) |
| `accessibility` | `reduce-issues`, `preserve`, `observe` | Accessibility checks (`m13`) |

The profile catalog uses the stable metric identifiers already used by the
assessment backend. Display names returned by the backend do not affect profile
resolution.

## Overlapping profiles

Multiple profiles may include the same metric. UIQLab preserves profile order
while resolving their metric lists and removes duplicate metric IDs. Each metric
therefore runs at most once per assessment.

For example:

```json
{
  "assessment": {
    "mode": "profiles",
    "profiles": [
      {
        "id": "visual-complexity",
        "direction": "decrease"
      },
      {
        "id": "layout-density",
        "direction": "more-spacious"
      }
    ]
  }
}
```

This resolves to:

```json
["m9", "m10", "m11", "m12", "m5", "m6"]
```

Although Feature congestion (`m10`) belongs to both profiles, it appears only
once.

## Custom metric selection

Manual metric selection remains available as `custom` mode:

```json
{
  "assessment": {
    "mode": "custom",
    "metrics": ["m8", "m10", "m13", "m14"]
  }
}
```

Existing configurations that define manual metrics under `ci.metrics` remain
supported and are treated as custom selection:

```json
{
  "ci": {
    "branches": ["main"],
    "metrics": ["m8", "m10", "m13", "m14"]
  }
}
```

Profile selection cannot be combined with either `assessment.metrics` or the
legacy `ci.metrics` field. A configuration must use profiles or manual metrics,
not both.

## Validation

Configuration loading fails with a descriptive error when:

- `assessment.mode` is not `profiles` or `custom`;
- the profile list is missing or empty;
- a profile ID is unknown;
- a direction is not allowed for its profile;
- the same profile is selected more than once;
- profile selection is combined with manual metrics;
- custom metrics are missing, duplicated, or outside `m1` through `m14`.

Both the CI client and IDE extension validate the configuration before starting
an assessment.

## Assessment results and reports

The selected mode and profile intent are passed to the orchestrator alongside
the resolved metric list. Assessment runs store this metadata and expose it in
run summaries used by IDE history and comparison flows.

For a profile-based assessment, the CI report includes:

```json
{
  "assessment": {
    "mode": "profiles",
    "profiles": [
      {
        "id": "visual-complexity",
        "direction": "decrease"
      }
    ]
  }
}
```

Custom assessments are represented as:

```json
{
  "assessment": {
    "mode": "custom"
  }
}
```

Profile IDs and directions are retained so future CI and IDE features can
explain results in the context of the user's intent.

## Quality gate

The CI client compares primary scalar metrics with the latest compatible
baseline using the existing deterministic materiality tolerances. Each profile
is classified as `aligned`, `opposed`, `mixed`, `unchanged`, or
`not-comparable`. A first run is `not-comparable`, establishes the baseline, and
passes.

Configure `qualityGate.mode` as `report`, `warn`, or `enforce`. The default is
`warn`. Report mode always exits successfully; warn mode returns a non-blocking
warning for mixed or opposed outcomes; enforce mode blocks opposed outcomes and
warns for mixed outcomes. The gate does not calculate an overall quality score.

LLM explanations remain outside the quality-gate flow.

## Relevant implementation files

- `apps/uiqlab-ci/src/assessmentProfiles.ts`: CI profile catalog and resolver.
- `apps/uiqlab-ci/src/config.ts`: CI configuration parsing and validation.
- `apps/uiqlab-ci/src/qualityGate.ts`: deterministic profile classification and gate decisions.
- `apps/uiqlab-ci/src/report.ts`: profile metadata in CI reports.
- `apps/uiqlab-assessment/src/assessmentProfiles.ts`: IDE profile catalog and resolver.
- `apps/uiqlab-assessment/src/projectConfig.ts`: IDE configuration parsing and validation.
- `apps/orchestrator/main.py`: assessment metadata persistence and run summaries.
- `.uiqlab.example.json`: example profile configuration.

## Verification

Run the focused checks with:

```sh
npm test --prefix apps/uiqlab-ci
npm run compile --prefix apps/uiqlab-assessment
python3 -m unittest discover -s apps/orchestrator
```

The orchestrator command requires the Python dependencies from
`apps/orchestrator/requirements.txt`.
