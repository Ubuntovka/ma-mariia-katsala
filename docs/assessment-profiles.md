# Assessment profiles

UIQLab supports predefined assessment profiles in both the CI/CD client and the
IDE extension. A profile selects a related group of metrics and records the
intended direction of the assessment. The direction is metadata only: it does
not currently affect metric execution or interpretation.

## IDE sidebar selection

The **UIQLab Assessment** sidebar offers two mutually exclusive modes:

- **Profiles** lists the six specific profiles and excludes `general-review`.
  Select one or more profiles and choose one allowed direction for every
  selected profile.
- **Custom metrics** lists `m1` through `m14`. Any combination can be selected,
  **All** and **None** controls are available, and every metric retains its
  expandable **What does this measure?** description.

When an assessment starts, the extension validates the active selection in the
extension host. Profile mode resolves profiles to metric IDs, removes overlaps,
and submits the profile metadata. Custom mode submits exactly the selected
metric IDs with `{ "mode": "custom" }` metadata. Switching modes clears the
inactive selection so previously checked profiles cannot affect a custom run,
and previously checked metrics cannot affect a profile run.

The assessment selection in `.uiqlab.json` initializes the corresponding
sidebar mode. A configured `general-review` selection initializes custom mode
with all 14 metrics because General review is deliberately absent from the
sidebar profile list. Without configured assessment settings, profile mode
opens without a preselected profile. Changes in the sidebar affect the
interactive run only and do not modify `.uiqlab.json`.

## IDE profile goal feedback

For a profile-based run with a compatible historical baseline, the IDE history
comparison starts with a visual profile-goal dashboard. The dashboard contains:

- an overall result such as **Profile goals achieved**, **Profile goals not
  achieved**, **Partially achieved**, or **Not enough comparison data**;
- one status card per selected profile, including its chosen direction;
- a horizontal change bar showing how many comparable primary metrics followed
  the direction, remained within the materiality threshold, or opposed it;
- a short deterministic reason for each outcome.

The existing detailed metric comparison remains directly below the dashboard.
Custom metric comparisons do not render the profile dashboard and keep their
current overview unchanged.

If **Use LLM explanation** is enabled during a profile run, the Evaluation
Results editor also shows structured **AI profile guidance**. The deterministic
history outcome remains authoritative; the LLM briefly explains the measured
movement and proposes two to four next-step experiments for the selected
directions. This appears as a status header, compact change rows, and numbered
suggestion cards rather than one prose block. Custom metric runs use a parallel
structured analysis panel that separates measured evidence, technical
interpretation, and practical implementation actions.

The sidebar provides a separate **Allow LLM to use source code (Demo)** toggle.
This experimental feature is available only for profile runs with LLM feedback,
stored per workspace, and off by default. With permission, the IDE extension
selects up to 10 relevant frontend files, limited to 24 KiB per file and 100 KiB
total. The files are supplied to the LLM to produce more precise,
project-specific suggestions. The active editor and assessed route are
prioritized; generated directories, dependencies, minified JavaScript, and
source maps are excluded. The LLM cannot search the project, and the captured
page HTML is not used as this source context. Without permission, the same
profile summary is generated from assessment/history data and suggestions use
metrics only.

The history comparison lists every metric requested by the current assessment,
not only metrics shared with the baseline. A requested metric without a
compatible historical result is shown by name with **No baseline available**.
Its current value is intentionally not repeated because it is already available
in **Evaluation Results**. If a stored baseline exists but cannot be compared,
the metric instead shows **Comparison unavailable**.

The dashboard is shown in the **Assessment History Comparison** editor opened
beside the raw **Evaluation Results** editor. After rebuilding the extension,
reload the Extension Development Host so it loads the new `dist/extension.js`.
If the orchestrator is running from Docker, restart that service after changing
the orchestrator source.

The IDE uses the same primary scalar extraction, materiality thresholds, and
direction mappings as the CI/CD quality-gate classification. `preserve` is
achieved when no meaningful change is detected. `observe` is presented as an
observation rather than as a pass/fail goal. Metrics without a deterministic
primary scalar remain visible in the detailed comparison but do not decide a
profile outcome.

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

Both the CI client and IDE extension validate configuration selections. The IDE
extension also validates selections submitted from the sidebar before starting
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
- `apps/uiqlab-assessment/src/assessmentSidebar.ts`: multi-profile and direction selection in the IDE sidebar.
- `apps/uiqlab-assessment/src/profileAssessment.ts`: deterministic IDE profile outcome and overall-goal classification.
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
