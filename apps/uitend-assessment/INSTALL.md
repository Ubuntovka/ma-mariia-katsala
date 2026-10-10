# Install UITend Assessment

In VS Code, open **Extensions**, select **…**, choose **Install from VSIX…**, and select the provided `.vsix` file. Reload VS Code if prompted.

## Build a VSIX

From this directory, run `npm install` and then `npm run package:vsix`. The
package is written to `uitend-assessment-<version>.vsix`, using the version in
`package.json`.

The current installation package is `uitend-assessment-0.0.5.vsix`.

## Controlled-experiment protocol build

`uiqlab-assessment-0.0.3.vsix` is the exact historical build used for the
thesis controlled-experiment protocol. Its original filename, branding, and
embedded metadata are intentionally preserved for reproducibility. It was
built from the `frozen-llm-response-for-evaluation` branch, allows only one
profile per run, shows prepared explanations instead of live LLM output, and
points to the experiment's production orchestrator. Use the UITend `0.0.5`
build for normal work.
