# Install UIQLab Assessment

In VS Code, open **Extensions**, select **…**, choose **Install from VSIX…**, and select the provided `.vsix` file. Reload VS Code if prompted.

## Build a VSIX

From this directory, run `npm install` and then `npm run package:vsix`. The
package is written to `uiqlab-assessment-<version>.vsix`, using the version in
`package.json`.

## Controlled-experiment build

`uiqlab-assessment-0.0.3.vsix` is the exact build used in the thesis controlled
experiment and is kept for reference only. It was built from the
`frozen-llm-response-for-evaluation` branch. That build allows only one profile
per run and shows prepared explanations instead of live LLM output, and it
points to the experiment's production orchestrator. Use a newer build for
normal work.
