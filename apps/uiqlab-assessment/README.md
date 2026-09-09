# UIQLab Assessment VS Code extension

The extension assesses deployed pages or captures locally running web apps with
headless Chromium, then sends the selected metrics to the UIQLab orchestrator.

## Development installation

Install Node.js 20.19+ and VS Code 1.125+, then run from the repository root:

```bash
npm ci --prefix apps/uiqlab-assessment
npx --prefix apps/uiqlab-assessment playwright-core install chromium
```

On Linux, run the following if Chromium reports missing system libraries:

```bash
npx --prefix apps/uiqlab-assessment playwright-core install-deps chromium
```

The production orchestrator is configured by default, so no local backend or
environment variables are required. Open this directory in VS Code and press
`F5` to launch an Extension Development Host.

The browser binary is not included in a standard VSIX. It must be packaged with
a release or installed on the machine running the extension host. In Remote
SSH, Codespaces, or containers, that host must also be able to reach the local
URL being assessed.

## Usage

1. Open **UIQLab Assessment** in the Activity Bar.
2. Choose a comparison mode. **Two deployed URLs** accepts a baseline URL and
   a current URL; the other current-state modes let you select **Deployment**
   or **Local URL** as the page source.
3. Select exactly one assessment profile, or choose custom metrics.
4. Run the assessment.

Local capture waits for the page to load, disables animations, and uploads a
fixed-viewport screenshot plus rendered HTML. Sidebar choices affect the current
IDE run; they do not rewrite the workspace `.uiqlab.json`.

## Prepared AI explanations during the experiment

Every completed profile assessment requests its explanation automatically. In
profile mode, the sidebar shows the AI explanation control as selected and
disabled, so it cannot be turned off. In custom metric mode, the control is
unselected and disabled; no AI explanation request is made, and any number of
metrics from one through all 14 can run together. During the controlled
experiment the orchestrator only loads a prepared PostgreSQL response for the
matching project, target, profile, and direction; it never contacts a live LLM
provider. Unsupported profile conditions fail closed with a clear explanation
error. Prepared explanations use metrics only, and measured results remain the
source of truth.

## Checks

```bash
npm test --prefix apps/uiqlab-assessment
npm run package --prefix apps/uiqlab-assessment
npm run test:integration --prefix apps/uiqlab-assessment
```

The integration suite is optional and starts a VS Code test host.
