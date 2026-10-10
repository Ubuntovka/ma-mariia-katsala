# UITend Assessment VS Code extension

The extension assesses deployed pages or captures locally running web apps with
headless Chromium, then sends the selected metrics to the UITend orchestrator.

## Development installation

Install Node.js 20.19+ and VS Code 1.125+, then run from the repository root:

```bash
npm ci --prefix apps/uitend-assessment
npx --prefix apps/uitend-assessment playwright-core install chromium
```

On Linux, run the following if Chromium reports missing system libraries:

```bash
npx --prefix apps/uitend-assessment playwright-core install-deps chromium
```

Start the orchestrator at `http://127.0.0.1:8181`, open this directory in VS
Code, and press `F5` to launch an Extension Development Host. To use another
orchestrator, for example a remote deployment, set
`uitendAssessment.orchestratorUrl` in VS Code settings to its complete
`http://` or `https://` base URL. A trailing slash is optional.

The browser binary is not included in a standard VSIX. It must be packaged with
a release or installed on the machine running the extension host. In Remote
SSH, Codespaces, or containers, that host must also be able to reach the local
URL being assessed.

## Usage

1. Open **UITend Assessment** in the Activity Bar.
2. Choose a comparison mode. **Two deployed URLs** accepts a baseline URL and
   a current URL; the other current-state modes let you select **Deployment**
   or **Local URL** as the page source.
3. Select one or more assessment profiles, or choose custom metrics.
4. Run the assessment.

Local capture waits for the page to load, disables animations, and uploads a
fixed-viewport screenshot plus rendered HTML. Sidebar choices affect the current
IDE run; they do not rewrite the workspace `.uitend.json`.

## Optional AI explanations

**Use LLM explanation** sends metrics and compatible history to the provider
configured by the orchestrator. **Allow LLM to use source code** additionally
sends at most 10 relevant frontend files (100 KiB total). Both options are off
by default. Do not send secrets, personal data, or confidential code without
authorisation. AI explanations may be inaccurate; measured results remain the
source of truth. Source-code sharing is not available when comparing two
deployed URLs; those explanations use assessment metrics only.

## Checks

```bash
npm test --prefix apps/uitend-assessment
npm run package --prefix apps/uitend-assessment
npm run test:integration --prefix apps/uitend-assessment
```

The integration suite is optional and starts a VS Code test host.
