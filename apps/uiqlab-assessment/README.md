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
- Select one or more metrics. Expand **What does this measure?** below any metric to read its definition and learn how to interpret its output.
- Choose **Current state vs latest assessment**, **Current state vs selected assessment**, or **Two previous assessments**. Historical assessments are selected in the sidebar before the action starts.
- Select **Run and compare** for a current-state mode, or **Compare assessments** for two historical runs. The sidebar hides page and metric controls when no new assessment is required.
- Local URLs (for example `http://localhost:3000`) are captured with Playwright.
- For a local URL, the extension opens a headless Chromium, waits for page load, waits until document.readyState === "complete", waits an extra 5s, disables animations, captures a fixed-viewport PNG and rendered HTML, then uploads the screenshot to the orchestrator.

VSIX packaging limitation:
- Playwright/browser binaries are not automatically included in a standard VSIX bundle. During development run `npx playwright install chromium` or ensure the host has Chromium available. For distribution, either include the browser in the package or instruct users to install it following the commands above.


## Features
Use the **UIQLab Assessment** sidebar to:

* keep all assessment inputs available in one persistent view
* choose one or more of the 14 available assessments and read what each metric measures
* choose how to get the page data:
  * Deployment URL
  * Take from my current code

The command then summarizes the selections and is ready to plug into the assessment runner.

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
