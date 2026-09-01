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

Start the orchestrator at `http://127.0.0.1:8181`, open this directory in VS
Code, and press `F5` to launch an Extension Development Host.

The browser binary is not included in a standard VSIX. It must be packaged with
a release or installed on the machine running the extension host. In Remote
SSH, Codespaces, or containers, that host must also be able to reach the local
URL being assessed.

## Usage

1. Open **UIQLab Assessment** in the Activity Bar.
2. Select **Deployment** or **Local URL** and enter the page URL.
3. Select one or more assessment profiles, or choose custom metrics.
4. Choose a comparison mode and run the assessment.

Local capture waits for the page to load, disables animations, and uploads a
fixed-viewport screenshot plus rendered HTML. Sidebar choices affect the current
IDE run; they do not rewrite the workspace `.uiqlab.json`.

## Optional AI explanations

**Use LLM explanation** sends metrics and compatible history to the provider
configured by the orchestrator. **Allow LLM to use source code** additionally
sends at most 10 relevant frontend files (100 KiB total). Both options are off
by default. Do not send secrets, personal data, or confidential code without
authorisation. AI explanations may be inaccurate; measured results remain the
source of truth.

## Checks

```bash
npm test --prefix apps/uiqlab-assessment
npm run package --prefix apps/uiqlab-assessment
npm run test:integration --prefix apps/uiqlab-assessment
```

The integration suite is optional and starts a VS Code test host.
