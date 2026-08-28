# UIQLab Assessment VS Code Extension

This extension supports assessing deployed URLs and now can capture locally running web applications using Playwright and upload screenshots and HTML to the orchestrator.

Installation (development):

- Install dependencies:

  cd apps/uiqlab-assessment
  npm install

- Install Chromium for Playwright (required when using local capture):

  npx playwright install chromium

Note: The extension depends on playwright-core. The browser binary is not bundled into the VSIX. For releases that include the browser, you must ensure the packaging step includes the browser binary or instruct users to run the above install command. Capture runs wherever the VS Code extension host is running — in Remote SSH/Codespaces/container environments capture executes there and must be able to reach the target localhost endpoint.

How to start a local web application (example):

  # in your project
  npm run dev
  # or e.g. create-react-app
  npm start

The local server should be reachable from the machine running the extension host, for example http://localhost:3000.

How to run an assessment:

- Open the **UIQLab Assessment** icon in the Activity Bar (or run **Run Assessment** from the Command Palette to reveal it).
- Choose **Deployment** or **Local URL** and enter the page URL in the persistent sidebar form.
- Choose **Profiles** to select one or more of the six specific assessment profiles and one direction for each selected profile. General review is not shown in this list.
- Alternatively, choose **Custom metrics** to select any combination of the 14 metrics. Use **All** or **None** to change the complete metric selection at once, and expand **What does this measure?** to read a short description of any metric.
- Profile mode runs the ordered, de-duplicated union of metrics assigned to the selected profiles. Custom mode runs exactly the checked metrics.
- Switching modes clears the inactive selection, so earlier profile choices cannot leak into a custom metric run or vice versa.
- Enable **Use LLM explanation** to receive an explanation after the run. It is off by default. The opening summary interprets the metrics in terms of likely user perception, such as visual density, scanning effort, vividness, hierarchy, and predicted attention, before presenting comparison details. Profile runs show a structured goal summary and suggested next steps. Custom metric runs show structured technical findings that separate measured evidence, interpretation, and practical implementation actions.
- **Allow LLM to use source code (Demo)** is an experimental permission for profile and custom-metric explanations and is off by default. When enabled, the extension sends at most 10 relevant frontend source files (100 KiB total) to the configured LLM provider. These files are used for more precise, project-specific interpretation and suggestions. Explanations still use metrics when the feature is off. The LLM does not search the project itself and the captured page HTML is not used as suggestion context.
- Choose **Current state vs latest assessment**, **Current state vs selected assessment**, or **Two previous assessments**. Historical assessments are selected in the sidebar before the action starts.
- Select **Run and compare** for a current-state mode, or **Compare assessments** for two historical runs. The sidebar hides page and profile controls when no new assessment is required.
- Local URLs (for example `http://localhost:3000`) are captured with Playwright.
- For a local URL, the extension opens a headless Chromium, waits for page load, waits until document.readyState === "complete", waits an extra 5s, disables animations, captures a fixed-viewport PNG and rendered HTML, then uploads the screenshot to the orchestrator.

## Privacy and AI notice

UIQLab does not provide an LLM service, model account, or API credentials. The
person operating the assessment backend must configure their own
OpenAI-compatible API endpoint, model, and API key. The selected provider, not
UIQLab, determines the applicable service terms and its retention, model
training, and international-transfer practices.

Enabling **Use LLM explanation** sends assessment metrics and compatible
history to that configured provider. Enabling **Allow LLM to use source code**
separately permits up to 10 selected frontend files, with a combined limit of
100 KiB, to be included. Do not submit secrets, personal data, or confidential
code unless you are authorised to do so and the configured provider is approved
for that data. The operator is responsible for selecting an appropriate
provider configuration and, where personal data is processed, establishing the
required legal basis, notices, contracts, and transfer safeguards.

LLM explanations are AI-generated advisory output and may be inaccurate. The
measured assessment results remain authoritative and should be used to verify
important decisions.

VSIX packaging limitation:
- Playwright/browser binaries are not automatically included in a standard VSIX bundle. During development run `npx playwright install chromium` or ensure the host has Chromium available. For distribution, either include the browser in the package or instruct users to install it following the commands above.


## Features
Use the **UIQLab Assessment** sidebar to:

* keep all assessment inputs available in one persistent view
* choose any combination of the six specific CI/CD assessment profiles (General review is excluded)
* choose one of the CI/CD directions supported by each selected profile
* evaluate exactly the metrics assigned to the selected profiles, with overlapping metrics run once
* alternatively choose any or all of the 14 metrics directly
* opt in to bounded workspace source sharing for profile or custom-metric explanations
* choose how to get the page data:
  * Deployment URL
  * Local URL

The command then summarizes the selections and is ready to plug into the assessment runner.

The sidebar initially uses the profile or custom metric selection configured in
the workspace `.uiqlab.json`. Because General review is not a sidebar profile,
a configured **General review / observe** selection initializes custom mode with
all 14 metrics checked. Sidebar changes apply to the interactive IDE run and do
not rewrite `.uiqlab.json`.

Profile directions are currently stored as assessment intent. The extension
does not use a direction to alter a profile's metric set. When a profile-based
run is compared with compatible history, the comparison view adds a visual goal
summary above the existing metric details. It shows whether each chosen
direction was achieved, opposed, partially achieved, unchanged, observed, or
not comparable. Custom metric comparisons retain the existing overview without
this profile summary. For both modes, every requested metric remains listed in
history comparison; metrics without compatible history show **No baseline
available** without duplicating their current value.

When **Use LLM explanation** is enabled for a profile run, the results view
adds an **AI profile guidance** panel. It uses the deterministic history-based
outcome as its fixed conclusion, summarizes the most relevant changes, and
shows numbered improvement suggestions. With source permission enabled,
suggestions may cite only the frontend files selected and supplied by the
extension; without permission, suggestions are based on metrics and profile
directions only. Custom metric assessments use a parallel card layout with a
professional technical summary and an evidence → interpretation → practical
action sequence for each finding.

For example if there is an image subfolder under your extension project workspace:

\!\[feature X\]\(images/feature-x.png\)

> Tip: Many popular extensions utilize animations. This is an excellent way to show off your extension! We recommend short, focused animations that are easy to follow.

## Requirements

If you have any requirements or dependencies, add a section describing those and how to install and configure them.

## Extension Settings

Include if your extension adds any VS Code settings through the `contributes.configuration` extension point.

For example:

This extension contributes the following settings:

* `myExtension.enable`: Enable/disable this extension.
* `myExtension.thing`: Set to `blah` to do something.

## Known Issues

Calling out known issues can help limit users opening duplicate issues against your extension.

## Release Notes

Users appreciate release notes as you update your extension.

### 1.0.0

Initial release of ...

### 1.0.1

Fixed issue #.

### 1.1.0

Added features X, Y, and Z.

---

## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

* [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Working with Markdown

You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:

* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux).
* Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux).
* Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets.

## For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
