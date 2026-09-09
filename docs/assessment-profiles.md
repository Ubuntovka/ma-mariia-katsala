# Assessment profiles

UIQLab supports predefined assessment profiles in both the CI/CD client and the
IDE extension. A profile selects a related group of metrics and records the
intended direction of the assessment. The direction does not affect metric
execution; it determines how scalar changes are classified in comparisons.

## IDE sidebar selection

The **UIQLab Assessment** sidebar offers two mutually exclusive modes:

- **Profiles** lists the five specific profiles and excludes `general-review`.
  During the controlled experiment, select exactly one profile and one of its
  allowed directions. Choosing another profile replaces the current choice.
- **Custom metrics** lists `m1` through `m14`. Any combination can be selected,
  **All** and **None** controls are available, and every metric retains its
  expandable **What does this measure?** description. Custom metric runs do not
  request an AI explanation during the controlled experiment.

When an assessment starts, the extension validates the active selection in the
extension host. Profile mode resolves profiles to metric IDs, removes overlaps,
and submits the profile metadata. Custom mode submits exactly the selected
metric IDs with `{ "mode": "custom" }` metadata. Switching modes clears the
inactive selection so previously checked profiles cannot affect a custom run,
and previously checked metrics cannot affect a profile run.

The assessment selection in `.uiqlab.json` initializes the corresponding
sidebar mode. If the configuration contains several profiles, the sidebar uses
only the first one for the controlled experiment. A configured
`general-review` selection initializes custom mode
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

During the controlled experiment, the Evaluation Results editor always requests
the prepared structured **AI profile guidance**. The sidebar shows the AI
explanation switch as selected and disabled. The deterministic history outcome
remains authoritative; the prepared record explains the measured movement and
provides the predefined next steps in the existing result component. The
orchestrator performs a PostgreSQL lookup and never calls a live LLM. Source
code is not collected or sent, so all prepared explanations are labelled
**Based on metrics only**. A missing or unsupported condition produces a clear
error without a live-generation fallback. Custom metric assessments keep the
AI control unselected and disabled and render their metric results without an
explanation request.

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

For a multi-page CI assessment, configure an ordered `ci.pages` array. Every
page has one or more of the seven profile IDs and one allowed direction for each
profile:

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

The CI client resolves each page's profiles and quality-gate mode independently,
de-duplicates overlapping metric IDs, and submits one orchestrator assessment
at a time. A page's directions, resolved metrics, and gate policy cannot leak
into another page. The top-level
`assessment` and `qualityGate` configuration remains available as the IDE
default and for the compatible single-page CI mode. Set `assessment.mode` to
`profiles` and provide one or more profile selections:

```json
{
  "projectKey": "123e4567-e89b-12d3-a456-426614174000",
  "name": "example-web-app",
  "assessment": {
    "mode": "profiles",
    "profiles": [
      {
        "id": "visual-clutter",
        "direction": "less-cluttered"
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

| Profile ID | Display name | Allowed directions | Metrics |
| --- | --- | --- | --- |
| `general-review` | General review | `observe` | All metrics, `m1` through `m14` |
| `visual-clutter` | Visual clutter | `less-cluttered`, `more-cluttered`, `preserve`, `observe` | Edge density (`m9`), Feature congestion (`m10`), Subband entropy (`m11`) |
| `screen-whitespace` | Screen white space | `more-whitespace`, `less-whitespace`, `preserve`, `observe` | White space proportion (`m5`) |
| `text-amount` | Text amount | `more-words`, `fewer-words`, `preserve`, `observe` | Word count (`m8`) |
| `colorfulness` | Colorfulness | `more-colorful`, `less-colorful`, `preserve`, `observe` | Colorfulness (`m3`) |
| `accessibility` | Accessibility | `fewer-detected-violations`, `preserve`, `observe` | Automatically detected violations (`m13`) |

The profile catalog uses the stable metric identifiers already used by the
assessment backend. Display names returned by the backend do not affect profile
resolution.

## Multiple profiles

UIQLab preserves profile order while resolving their metric lists and removes
duplicate metric IDs. Each metric therefore runs at most once per assessment.

For example:

```json
{
  "assessment": {
    "mode": "profiles",
    "profiles": [
      {
        "id": "visual-clutter",
        "direction": "less-cluttered"
      },
      {
        "id": "screen-whitespace",
        "direction": "more-whitespace"
      }
    ]
  }
}
```

This resolves to:

```json
["m9", "m10", "m11", "m5"]
```

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
- custom metrics are missing, duplicated, or outside `m1` through `m14`;
- `ci.pages` is empty, contains an invalid or duplicate route path, or is
  combined with legacy `ci.metrics`;
- a CI page has no profiles, repeats a profile, is missing a profile direction
  or `qualityGate.mode`, uses an unsupported direction, or uses an unknown gate
  mode.

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
        "id": "visual-clutter",
        "direction": "less-cluttered"
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

Multi-page CI output uses report schema version 2. Its ordered `pages` array
contains one complete page report with all profile selections for that
orchestrator run. Each page report retains its configured `report`, `warn`, or
`enforce` mode. The batch quality gate uses mode `per-page` and reflects the
most severe page gate.

## Quality gate

The CI client compares primary scalar metrics with the latest compatible
baseline using the existing deterministic materiality tolerances. Each profile
is classified as `aligned`, `opposed`, `mixed`, `unchanged`, or
`not-comparable`. A first run is `not-comparable`, establishes the baseline, and
passes.

Configure each multi-page entry's `qualityGate.mode` as `report`, `warn`, or
`enforce`. The global `qualityGate.mode` remains available for single-page CI
runs and defaults to `warn`. Report mode always exits successfully; warn mode
returns a non-blocking warning for mixed or opposed outcomes; enforce mode
blocks opposed outcomes and warns for mixed outcomes. The gate does not
calculate an overall quality score.

With multiple profiles on one page, `enforce` fails when at least one profile is
`opposed`; it warns when none are opposed but at least one is `mixed`. `warn`
produces a warning when at least one profile is `opposed` or `mixed`. Requiring
all profiles to be opposed would allow one regression to be hidden by unrelated
profile improvements.

LLM explanations remain outside the quality-gate flow.

## Relevant implementation files

- `apps/uiqlab-ci/src/assessmentProfiles.ts`: CI profile catalog and resolver.
- `apps/uiqlab-ci/src/config.ts`: CI configuration parsing and validation.
- `apps/uiqlab-ci/src/qualityGate.ts`: deterministic profile classification and gate decisions.
- `apps/uiqlab-ci/src/report.ts`: profile metadata in CI reports.
- `apps/uiqlab-ci/src/workflow.ts`: ordered page URL resolution and sequential execution.
- `apps/uiqlab-assessment/src/assessmentProfiles.ts`: IDE profile catalog and resolver.
- `apps/uiqlab-assessment/src/assessmentSidebar.ts`: multi-profile and direction selection in the IDE sidebar.
- `apps/uiqlab-assessment/src/profileAssessment.ts`: deterministic IDE profile outcome and overall-goal classification.
- `apps/uiqlab-assessment/src/projectConfig.ts`: IDE configuration parsing and validation.
- `apps/orchestrator/main.py`: assessment metadata persistence and run summaries.
- `docs/uiqlab.example.json`: example profile configuration.

## Verification

Run the focused checks with:

```sh
npm test --prefix apps/uiqlab-ci
npm run compile --prefix apps/uiqlab-assessment
python3 -m unittest discover -s apps/orchestrator
```

The orchestrator command requires the Python dependencies from
`apps/orchestrator/requirements.txt`.
