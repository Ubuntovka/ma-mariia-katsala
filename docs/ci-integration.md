# CI integration

The UITend CI client assesses one or more routes from a deployed commit
preview. It writes:

- `uitend-report.html`: a self-contained visual report with comparisons and
  embedded captures;
- `uitend-report.json`: the machine-readable report.

Pages run sequentially. Each is compared with the latest compatible assessment
from the configured baseline branch.

## Setup

1. Commit `.uitend.json` at the application repository root. Keep the
   `projectKey` created by the UITend extension.
2. Deploy the current commit to a URL reachable by the UITend services.
3. Set `UITEND_ORCHESTRATOR_URL` as a protected CI/CD variable when
   appropriate.
4. Pass the preview URL to the assessment job as `UITEND_PREVIEW_URL`.
5. Run the client and retain both reports as job artifacts.

The first compatible run establishes a baseline and passes unless
`requireBaseline` is enabled.

## Configuration

A multi-page configuration looks like this:

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
        "qualityGate": {
          "mode": "enforce",
          "requireBaseline": true
        }
      }
    ],
    "timeoutMs": 300000,
    "pollIntervalMs": 2000
  }
}
```

See [uitend.example.json](uitend.example.json) for a larger example and
[assessment profiles](assessment-profiles.md) for profile IDs and directions.

### Main options

| Setting | Required/default | Purpose |
| --- | --- | --- |
| `projectKey` | Required UUID | Identifies the project across branches and pipelines. |
| `name` | Recommended | Project name shown in metadata. |
| `ci.branches` | Required | Exact branch names or glob patterns to assess. |
| `ci.baselineBranch` | Default `main` | Branch used for historical comparisons. |
| `ci.pages` | Recommended | Ordered route configurations for multi-page profile mode. |
| `ci.timeoutMs` | Default `300000` | Maximum wait per page. |
| `ci.pollIntervalMs` | Default `2000` | Delay between result requests. |

Each `ci.pages[]` entry requires:

| Setting | Purpose |
| --- | --- |
| `path` | Route beginning with `/`, without a query or fragment. |
| `profiles` | One or more unique `{ "id", "direction" }` objects. |
| `qualityGate.mode` | `report`, `warn`, or `enforce`. |
| `qualityGate.requireBaseline` | Optional boolean; defaults to `false`. |

Branch globs match the whole name: `*` does not cross `/`, `**` does, and
`?` matches one non-`/` character.

For a single-page run, omit `ci.pages` and set the top-level `assessment`
and `qualityGate`. Custom mode accepts `m1` through `m14`; the legacy
`ci.metrics` field is also supported. Do not mix profiles and manual metrics.

## Quality gates and exit codes

| Mode | Aligned, unchanged, or not comparable | Mixed | Opposed |
| --- | --- | --- | --- |
| `report` | Pass (`0`) | Pass (`0`) | Pass (`0`) |
| `warn` | Pass (`0`) | Warning (`2`) | Warning (`2`) |
| `enforce` | Pass (`0`) | Warning (`2`) | Fail (`1`) |

`requireBaseline: true` fails with exit code `1` when no compatible
baseline exists. Technical errors also exit `1`. Set
`UITEND_WARNING_EXIT_CODE=0` if the CI provider cannot treat exit code `2`
as an allowed warning.

## Variables and command-line options

CLI flags override their environment-variable equivalents.

| Environment variable | CLI flag | Default or purpose |
| --- | --- | --- |
| `UITEND_ORCHESTRATOR_URL` | `--orchestrator-url` | Required for assessed branches. |
| `UITEND_PREVIEW_URL` | `--url` | Required public preview base URL. |
| `UITEND_BRANCH` | `--branch` | Overrides automatic branch detection. |
| `UITEND_CONFIG` | `--config` | Default `.uitend.json`. |
| `UITEND_REPORT` | `--report` | Default `uitend-report.json`. |
| `UITEND_HTML_REPORT` | `--html-report` | Default `uitend-report.html`. |
| `UITEND_WARNING_EXIT_CODE` | `--warning-exit-code` | `0` or `2`; default `2`. |
| `UITEND_COMMIT_SHA` | — | Optional commit override. |
| `UITEND_REPOSITORY_URL` | — | Optional repository URL override. |
| `UITEND_MERGE_REQUEST_ID` | — | Optional merge-request ID override. |

## GitLab CI example

The preview job must write only the public base URL to `preview.env`.
Adapt the build and deployment commands to the application:

```yaml
stages: [preview, assess]

ui-preview:
  stage: preview
  image: node:20
  script:
    - npm ci
    - npm run build
    - echo "UITEND_PREVIEW_URL=$(./scripts/deploy-preview.sh)" > preview.env
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
    - if [ -n "$CI_MERGE_REQUEST_SOURCE_BRANCH_NAME" ]; then export UITEND_BRANCH="$CI_MERGE_REQUEST_SOURCE_BRANCH_NAME"; else export UITEND_BRANCH="$CI_COMMIT_BRANCH"; fi
  script:
    - npm ci --prefix apps/uitend-ci
    - npm run build --prefix apps/uitend-ci
    - node apps/uitend-ci/dist/src/cli.js
  allow_failure:
    exit_codes: [2]
  artifacts:
    when: always
    expire_in: 1 week
    paths:
      - uitend-report.html
      - uitend-report.json
```

Add `UITEND_ORCHESTRATOR_URL` under **Settings > CI/CD > Variables** rather
than hard-coding it. The `before_script` is needed because GitLab
merge-request pipelines expose the source branch as
`CI_MERGE_REQUEST_SOURCE_BRANCH_NAME`.

The example builds the client from `apps/uitend-ci`. Change those three
commands if the consuming project obtains it elsewhere. Keep the preview
reachable until the report is complete so captures and visual metric files can
be embedded.

## Other CI providers and local runs

Any provider can run the client by setting the required variables and invoking:

```bash
npm ci --prefix apps/uitend-ci
npm run build --prefix apps/uitend-ci
node apps/uitend-ci/dist/src/cli.js
```

The client requires Node.js 18 or later. It detects common GitLab and GitHub
branch, commit, repository, and pull-request variables; use the overrides above
when automatic detection is insufficient.

## Troubleshooting

| Problem | Check |
| --- | --- |
| Branch cannot be determined | Set `UITEND_BRANCH`; for GitLab merge requests, use `CI_MERGE_REQUEST_SOURCE_BRANCH_NAME`. |
| Preview URL is missing | Confirm the preview job writes and exports `UITEND_PREVIEW_URL`. |
| Assessment times out | Verify the preview and orchestrator are reachable, then increase `ci.timeoutMs` only if metrics legitimately need longer. |
| No baseline appears | Check `ci.baselineBranch`, route paths, and capture dimensions. |
| Reports are missing after failure | Use `artifacts.when: always` and keep artifact paths aligned with any CLI overrides. |
