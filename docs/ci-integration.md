# CI Integration

## Purpose

The UIQLab CI client runs Web UI Assessments against several routes of a public
commit preview. It processes the configured pages in order. For each page it
submits one URL to the orchestrator, waits for that page's profile metrics, and
compares the results with the same page's latest compatible assessment from the
baseline branch before starting the next page. The client writes two artifacts
after every run:

- `uiqlab-report.html` is a self-contained, responsive visual report with the
  same palette and information hierarchy as the IDE results. It includes the
  overall gate, page and profile outcomes, baseline comparisons, metric cards,
  embedded visual metric files, and expandable raw values. It has no JavaScript
  or external stylesheet. Visual files are fetched while the CI job can still
  reach the evaluator, avoiding broken `localhost` URLs in downloaded artifacts.
- `uiqlab-report.json` remains the machine-readable source of truth for later
  automation.

The HTML report also includes print styles, so it can be opened in a browser
and printed or saved as PDF without requiring a separate CI dependency.

For profile-based assessments, the client classifies meaningful metric changes
against the selected directions and applies the configured quality-gate mode.
It reuses fixed comparison tolerances and does not calculate an overall score.

## When the assessment runs

The CI provider decides when a pipeline and its jobs are created. After the job
starts, the UIQLab client checks the current branch against `ci.branches` in
`.uiqlab.json`.

The recommended behavior is:

- run after every commit pushed to a configured branch;
- run for every new commit in a merge request, using the source branch and the
  merge request's preview environment;
- run again after a merge if the merge creates a new commit on a configured
  target branch;
- avoid creating both a branch pipeline and a merge-request pipeline for the
  same commit.

If the branch does not match `ci.branches`, the client writes a report with
`"status": "skipped"` and exits successfully. The preview job may still have
run by that point. To avoid creating unnecessary preview environments, mirror
the relevant branch conditions in the CI provider's job rules.

## UIQLab project configuration

The extension and CI client share the repository-root `.uiqlab.json` file:

```json
{
  "projectKey": "123e4567-e89b-12d3-a456-426614174000",
  "name": "example-web-app",
  "ci": {
    "branches": ["main", "feature/ui-*", "redesign/**"],
    "baselineBranch": "main",
    "pages": [
      {
        "path": "/checkout",
        "profiles": [
          { "id": "accessibility", "direction": "reduce-issues" },
          { "id": "content-density", "direction": "decrease" }
        ],
        "qualityGate": { "mode": "enforce" }
      }
    ],
    "timeoutMs": 300000,
    "pollIntervalMs": 2000
  }
}
```

| Setting | Required | Meaning |
| --- | --- | --- |
| `projectKey` | Yes | UUID shared with the UIQLab extension. |
| `name` | No | Human-readable project name. |
| `assessment` | No | Existing single-page profile/custom-metric selection and IDE default. Used by CI only when `ci.pages` is omitted. |
| `qualityGate.mode` | No | Global mode for compatible single-page CI runs: `report`, `warn`, or `enforce`. Defaults to `warn`. |
| `ci.branches` | Yes | Branches eligible for assessment. Exact names and `*`, `**`, and `?` globs are supported. |
| `ci.baselineBranch` | No | Branch used for the historical comparison. Defaults to `main`. |
| `ci.pages` | No | Ordered pages for a multi-page CI run. Each entry requires one route `path`, a non-empty `profiles` array containing profile IDs and directions, and its own `qualityGate.mode`. |
| `ci.metrics` | No | Legacy manual metric IDs from `m1` through `m14`; treated as custom mode and not allowed with profiles. |
| `ci.timeoutMs` | No | Maximum time to wait for each page's metrics. Defaults to 300,000 ms. |
| `ci.pollIntervalMs` | No | Delay between result requests. Defaults to 2,000 ms. |

## Required CI inputs

| Variable | Required | Meaning |
| --- | --- | --- |
| `UIQLAB_ORCHESTRATOR_URL` | Yes | Externally reachable orchestrator base URL. Store it as a CI/CD variable. |
| `UIQLAB_PREVIEW_URL` | Yes for assessed branches | Public preview base URL produced by an earlier job. Every `ci.pages[].path` is appended to this URL. |
| `UIQLAB_BRANCH` | Sometimes | Explicit branch override. It is currently required for GitLab merge-request pipelines; see below. |
| `UIQLAB_COMMIT_SHA` | No | Explicit commit override. Otherwise detected from the CI provider or Git. |
| `UIQLAB_REPOSITORY_URL` | No | Explicit repository URL override. Otherwise detected automatically. |
| `UIQLAB_MERGE_REQUEST_ID` | No | Explicit merge-request ID override. GitLab and GitHub metadata are normally detected automatically. |

Page paths must start with `/`, must not contain a query or fragment, and must be
unique after trailing-slash normalization. The preview must not depend on a
developer's local machine or an authenticated browser session. Every resulting
page URL must be reachable from the assessment service for the duration of the
job. `ci.pages` cannot be combined with `ci.metrics`; profile metric resolution
and quality-gate evaluation are page-specific. Page gate modes do not inherit
from the top-level gate. When `ci.pages` is omitted, the client retains the
existing single-page behavior and assesses the exact `UIQLAB_PREVIEW_URL` using
the top-level `assessment` selection (or legacy custom metrics) and global gate.
The earlier singular page `profile` and `direction` fields remain accepted for
configuration compatibility.

## GitLab CI

The following workflow creates merge-request pipelines, suppresses the duplicate
branch pipeline when a branch already has an open merge request, and otherwise
creates normal branch pipelines:

```yaml
workflow:
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    - if: '$CI_COMMIT_BRANCH && $CI_OPEN_MERGE_REQUESTS'
      when: never
    - if: '$CI_COMMIT_BRANCH'

stages: [preview, assess]

ui-preview:
  stage: preview
  script:
    - npm ci
    - npm run build
    - echo "UIQLAB_PREVIEW_URL=$(./scripts/deploy-preview.sh)" > preview.env
  artifacts:
    reports:
      dotenv: preview.env

web-ui-assessment:
  stage: assess
  image: node:20
  needs:
    - job: ui-preview
      artifacts: true
  before_script:
    - if [ -n "$CI_MERGE_REQUEST_SOURCE_BRANCH_NAME" ]; then export UIQLAB_BRANCH="$CI_MERGE_REQUEST_SOURCE_BRANCH_NAME"; else export UIQLAB_BRANCH="$CI_COMMIT_BRANCH"; fi
  script:
    - npm ci --prefix apps/uiqlab-ci
    - npm run build --prefix apps/uiqlab-ci
    - node apps/uiqlab-ci/dist/src/cli.js
  allow_failure:
    exit_codes:
      - 2
  artifacts:
    when: always
    paths:
      - uiqlab-report.html
      - uiqlab-report.json
```

Replace `./scripts/deploy-preview.sh` with the application's actual preview
deployment command.

### Merge-request branch detection

GitLab merge-request pipelines normally set
`CI_MERGE_REQUEST_SOURCE_BRANCH_NAME`, while `CI_COMMIT_BRANCH` is unavailable.
The current client detects `CI_COMMIT_BRANCH` but does not yet automatically
read `CI_MERGE_REQUEST_SOURCE_BRANCH_NAME`. The `before_script` above sets
`UIQLAB_BRANCH` to the correct source branch as a workaround. The merge-request
IID itself is detected automatically from `CI_MERGE_REQUEST_IID`.

In merge-request pipelines from forks, protected CI/CD variables may be
unavailable. Ensure the orchestrator URL and preview deployment can be used in
the project's chosen fork security model; do not expose secrets to untrusted
pipeline code.

## GitHub Actions

Configure the workflow to run for pushes and pull requests. Restrict the branch
lists to the branches relevant to the project:

```yaml
name: Web UI Assessment

on:
  push:
    branches:
      - main
      - 'feature/ui-*'
      - 'redesign/**'
  pull_request:

jobs:
  uiqlab:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Create public preview
        id: preview
        run: echo "url=$(./scripts/deploy-preview.sh)" >> "$GITHUB_OUTPUT"

      - name: Assess Web UI
        env:
          UIQLAB_ORCHESTRATOR_URL: ${{ secrets.UIQLAB_ORCHESTRATOR_URL }}
          UIQLAB_PREVIEW_URL: ${{ steps.preview.outputs.url }}
        run: |
          npm ci --prefix apps/uiqlab-ci
          npm run build --prefix apps/uiqlab-ci
          node apps/uiqlab-ci/dist/src/cli.js

      - name: Attach assessment report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: uiqlab-assessment
          path: |
            uiqlab-report.html
            uiqlab-report.json
          if-no-files-found: ignore
```

GitHub provides the pull request's source branch through `GITHUB_HEAD_REF`,
which the client detects automatically. Repository secrets are normally not
provided to workflows triggered by pull requests from forks, so forked pull
requests may need to skip the assessment or use a separately secured workflow.

## Successful, skipped, and failed jobs

### Successful assessment

The job exits with code `0` when every page gate passes, prints page-specific
profile outcomes and metric comparisons, and writes a completed JSON report.
A missing baseline does not fail a page assessment; that run establishes the
page's baseline and is classified as `not-comparable`.

Multi-page reports use schema version 2. Their ordered `pages` array contains
the complete schema-version-1 report for each page, including its target,
result ID, profiles, metrics, comparison, and independently configured page
quality gate. The top-level gate uses mode `per-page`, reports the most severe
page gate (`fail`, then `warning`, then `pass`), and determines the process exit
code.

Exit code `2` is a non-blocking warning produced by `warn` mode for `mixed` or
`opposed` outcomes and by `enforce` mode for `mixed` outcomes. Exit code `1`
represents either an enforced `opposed` outcome or a technical failure.
For pages with multiple profiles, one opposed profile is sufficient to fail an
`enforce` page; one opposed or mixed profile is sufficient to warn a `warn`
page.

### Skipped assessment

If the current branch does not match `ci.branches`, the client exits with code
`0` and writes a skipped report. This is a normal outcome, not a warning or
failure.

### Technical failure

The client exits with code `1` when it cannot complete the assessment. Examples
include:

- a missing, unreadable, or invalid `.uiqlab.json` file;
- an unknown branch or repository URL;
- a missing orchestrator URL or preview URL;
- an invalid preview URL;
- an HTTP, connectivity, timeout, or invalid-JSON error;
- an orchestrator response without a result ID;
- a page assessment that does not finish before its `ci.timeoutMs` deadline;
- a configured metric that completes without results.

Dependency installation, application build, preview deployment, and artifact
upload can also fail independently of the UIQLab client.

Exit code `2` represents a non-blocking quality warning. Configure GitLab to
allow that code while keeping exit code `1` blocking:

```yaml
web-ui-assessment:
  allow_failure:
    exit_codes:
      - 2
```

Technical errors and enforced opposed outcomes use exit code `1` and continue
to block the job. Artifacts use `when: always`, so `uiqlab-report.html` and
`uiqlab-report.json` are uploaded for passes, warnings, and failures. The client
also creates both files for a branch that is skipped.

## Running the client manually

From the repository root, using Node.js 18 or later:

```bash
npm ci --prefix apps/uiqlab-ci
npm run build --prefix apps/uiqlab-ci
node apps/uiqlab-ci/dist/src/cli.js
```

Optional command-line flags are `--config`, `--report`, `--html-report`, `--url`,
`--branch`, and `--orchestrator-url`. `--report` changes the JSON path and
`--html-report` changes the visual report path. `UIQLAB_REPORT` and
`UIQLAB_HTML_REPORT` are the equivalent environment variables.

## Troubleshooting

### `Could not determine the CI branch`

In a GitLab merge-request pipeline, set `UIQLAB_BRANCH` from
`CI_MERGE_REQUEST_SOURCE_BRANCH_NAME` as shown in the GitLab example.

### `UIQLAB_PREVIEW_URL is required`

Check that the preview job writes a dotenv artifact, that the assessment job
downloads it through `needs`, and that the deployment command produced a URL.

### Assessment timeout

Confirm that the preview is publicly reachable from the orchestrator, inspect
the orchestrator logs, and increase `ci.timeoutMs` only if the metrics are
working but legitimately need more time.

### No baseline is shown

Confirm that `ci.baselineBranch` names the intended branch and that at least one
compatible assessment has completed on it. This condition does not fail the
job.
