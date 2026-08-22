# LLM-Based Assessment Explanations

## Purpose

The LLM integration turns raw Web UI Assessment metric results into a concise,
structured explanation. Custom metric assessments use professional
computer science and human-computer interaction terminology and separate
measured evidence, technical interpretation, and practical implementation work.
For profile assessments, the integration explains the deterministic profile
outcome and proposes practical code improvements that support the directions
selected by the developer.

It explains:

- what the measured values mean;
- which results appear most important;
- how the current result differs from a previous comparable run, when history
  is available;
- which conclusions are measurements and which are only possible
  interpretations.

The LLM does not replace the raw results. Its explanation appears above them,
with a reminder to verify important decisions against the measured values.

## Architecture and security boundary

```text
VS Code webview
      |
      | displays the explanation
      v
VS Code extension
      |
      | POST /eval/explanation
      | current results + available history + profile outcome
      | optionally: bounded frontend source selected by the extension
      v
Orchestrator (FastAPI)
      |
      | reads URL, key, model, and timeout from environment variables
      | sends an authenticated Chat Completions request
      v
University/OpenAI-compatible LLM provider
```

The LLM cannot browse or search the workspace itself. When source sharing is
permitted, the extension explicitly discovers and reads a bounded set of
relevant frontend files and includes their contents in this request. It does
not send the captured/rendered page HTML as profile-suggestion context.

The provider URL and API key exist only in the root `.env` file and the
orchestrator container environment. They are not compiled into the extension,
sent to the webview, or returned by the explanation endpoint.

The root `.env` file is ignored by Git. `.env.example` contains only placeholder
configuration and is safe to commit.

## Privacy and operator responsibility

UIQLab does not provide an LLM service, model account, or API credentials. The
person operating the assessment backend selects and configures their own
OpenAI-compatible API endpoint, model, and API key. Consequently, the selected
provider's terms and configured retention, model-training, and international-
transfer practices apply to LLM requests.

When **Use LLM explanation** is enabled, assessment metrics and compatible
history are sent to the configured provider. Source files are included only
when **Allow LLM to use source code** is separately enabled, subject to the
limits documented below. Operators should not submit secrets, personal data, or
confidential code unless they are authorised to do so and the selected provider
is approved for that data. Where personal data is processed, the operator is
responsible for the applicable legal basis, transparency information, processor
terms, and transfer safeguards.

The sidebar presents this information in a collapsible **Privacy and AI notice**
beside the LLM controls. Generated explanations are advisory and may be
inaccurate; the deterministic assessment results remain authoritative.

## Configuration

The integration uses these variables:

| Variable | Required | Purpose |
| --- | --- | --- |
| `LLM_API_URL` | Yes | OpenAI-compatible API base URL or full Chat Completions URL. |
| `LLM_API_KEY` | Yes | Secret bearer token used only by the orchestrator. |
| `LLM_MODEL` | Yes | Provider-specific model name. |
| `LLM_TIMEOUT_SECONDS` | No | Provider response timeout. Defaults to 180 seconds, with a minimum of 10 seconds. |

Example university configuration:

```dotenv
LLM_API_URL=https://university-provider.example/v1
LLM_API_KEY=replace-with-the-real-secret
LLM_MODEL=replace-with-the-university-model-name
LLM_TIMEOUT_SECONDS=180
```

Example OpenAI configuration:

```dotenv
LLM_API_URL=https://api.openai.com/v1
LLM_API_KEY=replace-with-an-openai-api-key
LLM_MODEL=replace-with-a-chat-completions-model
LLM_TIMEOUT_SECONDS=180
```

`docker-compose.yml` passes these variables only to the orchestrator service.
After changing `.env`, recreate the service:

```bash
docker compose up -d --build orchestrator
```

## Supported provider URL forms

The orchestrator accepts either a base URL or a complete endpoint. The helper
`resolve_llm_chat_completions_url()` normalizes the configuration as follows:

| Configured value | Requested value |
| --- | --- |
| `https://provider.example` | `https://provider.example/v1/chat/completions` |
| `https://provider.example/v1` | `https://provider.example/v1/chat/completions` |
| `https://provider.example/v1/chat/completions` | unchanged |

This normalization fixed the original integration problem where a request was
sent directly to `/v1` and the university web server returned HTTP 403.

## Runtime flow

1. The extension submits a page for assessment and polls until metric results
   are available.
2. It requests matching assessment history from
   `GET /eval/result/{result_id}/history`.
3. For a profile run, it calculates the same deterministic profile outcome
   shown in the history dashboard. If source sharing was enabled, it also
   selects relevant frontend source files from the workspace.
4. It calls `fetchAssessmentExplanation()` with the current metric results,
   returned history, assessment selection, and profile context.
5. `fetchAssessmentExplanation()` sends the data to
   `POST /eval/explanation` on the orchestrator.
6. The orchestrator validates that LLM configuration and current results exist.
7. It reduces and sanitizes the assessment payload, adds metric definitions,
   and builds system and user messages.
8. It calls the provider using bearer authentication and the configured model.
9. Custom runs validate structured JSON containing a summary and technical
   findings. Profile runs validate structured JSON containing a summary, change
   observations, and suggestions.
10. The webview escapes every returned field. It displays custom analysis as
    evidence, interpretation, and practical-action cards, and profile guidance as
    status, change, and suggestion cards above the raw metric results.

The extension sidebar includes a **Use LLM explanation** toggle. When enabled,
both deployment-URL and local-URL assessment flows request an explanation. When
disabled, no request is sent to the explanation endpoint and the results panel
shows the raw metric results without an explanation block. The preference is
stored per workspace and defaults to disabled. On the first load after this
default changed, the extension resets the earlier enabled-by-default value and
source-sharing preference to disabled once. Choices made after that migration
remain stored per workspace.
History is included only when the history endpoint finds a comparable previous
run. Screenshot-based comparisons require matching screenshot dimensions.

Profile mode additionally shows **Allow LLM to use source code (Demo)**. This
experimental feature is an independent permission, is off by default, and is
disabled outside profile mode or when LLM explanations are disabled. Turning it
on permits selected source files to leave the developer's machine and reach the
configured LLM provider. The files are used to produce more precise,
project-specific suggestions. Profile guidance still works with metric/history
data when it is off; suggestions then use metrics only.

## Orchestrator API contract

### Request

```http
POST /eval/explanation
Content-Type: application/json
```

```json
{
  "currentResults": [
    {
      "metric_id": "m9_edge_density",
      "results": [0.24]
    }
  ],
  "history": {
    "metrics": {
      "m9_edge_density": {
        "results": [0.18],
        "createdAt": "2026-01-01T12:00:00Z"
      }
    }
  },
  "assessment": {
    "mode": "profiles",
    "profiles": [{ "id": "visual-complexity", "direction": "decrease" }]
  },
  "profileAssessment": {
    "status": "achieved",
    "title": "Profile goal achieved",
    "description": "Every evaluated profile moved in its chosen direction.",
    "outcomes": []
  },
  "target": "http://localhost:3000/dashboard",
  "sourceContext": [
    { "path": "src/pages/dashboard.tsx", "content": "export function Dashboard() { ... }" }
  ]
}
```

`assessment`, `profileAssessment`, `target`, and `sourceContext` are optional.
They are supplied for profile guidance; custom metric calls remain compatible
with the original `currentResults` and `history` request.

### Successful response

```json
{
  "explanation": "Visual complexity moved in the selected direction.",
  "profileFeedback": {
    "goalStatus": "achieved",
    "goalTitle": "Profile goal achieved",
    "summary": "Visual complexity moved in the selected direction.",
    "changes": ["The comparable complexity metrics decreased."],
    "suggestions": [{
      "title": "Preserve the simpler hierarchy",
      "action": "Keep secondary elements visually subordinate and retest after changes.",
      "rationale": "This supports the selected decrease direction.",
      "files": ["src/pages/dashboard.tsx"]
    }],
    "sourceContextUsed": true,
    "sourceFiles": ["src/pages/dashboard.tsx"]
  }
}
```

Custom metric assessments return `explanation` for compatibility and a
`customFeedback` object containing `summary`, `analysisMode`,
`materialChangeCount`, and up to six validated `findings`. Each finding contains
`title`, `metricIds`, `observation`, `interpretation`, and `recommendation`.

### Important response codes

| Status | Meaning |
| --- | --- |
| `400` | No current metric results were provided. |
| `502` | The provider rejected the request or returned an invalid response. |
| `503` | One or more required LLM environment variables are missing. |
| `504` | Connecting to the provider or waiting for its response timed out. |

Provider URLs, keys, and raw provider response bodies are deliberately excluded
from client-facing errors.

## Prompt construction

`build_explanation_messages()` creates two messages:

- For custom metrics, a system message requires precise professional
  computer-science and HCI language without slang or colloquialisms. It tells
  the model to cover every preselected comparison finding, combine overlaps,
  distinguish observations from interpretations, and provide concrete,
  reversible interface or implementation changes. Recommendations cannot use
  further analysis, auditing, monitoring, or research as their primary action;
  measurement may only verify a proposed change.
- A user message contains metric definitions, current results, and available
  previous results as JSON data. It also contains a deterministic comparison
  selection produced before the model is called.

For profile mode, the prompt treats the deterministic profile outcome as
authoritative and asks for compact JSON rather than Markdown. The LLM may
explain that outcome but cannot redefine whether the goal was achieved. It must
relate suggestions to the chosen profile directions. When source is supplied,
it may cite only actual supplied paths; the orchestrator removes invented paths
from the response. Source contents and assessment values are explicitly marked
as untrusted data rather than instructions.

Source-free profile requests omit raw result artifacts and use the deterministic
comparison values/deltas instead. Their response budget is 900 tokens, which is
enough for the short structured summary while reducing provider latency. Custom
metric explanations use a 1,800-token response budget for up to six structured
finding cards.

`METRIC_EXPLANATIONS` provides short domain descriptions for metrics M1–M14.
This gives the model enough context to explain values such as edge density,
feature congestion, entropy, NIMA, and accessibility results without assuming
the reader already understands them.

The prompt explicitly instructs the model to treat assessment values as data,
not instructions. It also tells the model not to invent thresholds, causes, or
recommendations unsupported by the results.

For comparisons, `select_comparison_findings()` applies fixed absolute and
relative materiality rules to each supported primary metric value. It recognizes
cross-metric patterns only when at least two material changes in a predefined
group move in the same direction. Pattern and individual candidates are sorted
by a stable score and metric-ID tie-breaker. Every qualifying finding is sent to
the model. The prompt asks it to synthesize overlapping evidence, draw cautious
conclusions, and suggest feasible experiments rather than repeat values already
shown in the comparison UI. For direction-neutral metrics, suggestions cover the
trade-off and possible movement in either direction depending on the design goal.
“Material” here is a reporting rule, not a statistical-significance claim. The
provider temperature is set to zero to reduce wording variation; finding
selection itself does not depend on the model.

## Payload reduction and privacy

Before assessment data is sent to the provider, `compact_llm_value()` applies
basic limits:

- artifact URLs are replaced with `[artifact URL omitted]`;
- strings are limited to 1,000 characters;
- lists and dictionaries are limited to 50 entries at each level;
- content nested deeper than six levels is omitted;
- custom-mode serialized assessment data is limited to 30,000 characters;
- profile-mode data has a 140,000-character ceiling to accommodate the
  separately bounded opt-in source context.

Opt-in source context has separate hard limits:

- frontend source types only: HTML, CSS/preprocessor files, JavaScript,
  TypeScript, JSX/TSX, Vue, and Svelte;
- generated output, dependency directories, source maps, and minified
  JavaScript are excluded;
- no more than 10 files, 24 KiB per file, and 100 KiB total;
- the active editor and files matching the assessed URL route are prioritized;
- the orchestrator reapplies the file and byte limits before calling the
  provider.

The response is limited to 1,600 tokens in the provider request so all material
findings can be covered without forcing repetitive detail. The integration
does not currently cache explanations or store them in PostgreSQL; a new
explanation is requested for every completed assessment.

## Webview behavior

The results panel has four explanation states:

1. While assessment metrics are still arriving, no explanation block is shown.
2. After a successful custom-metric LLM call, a **Plain-language explanation**
   section is rendered above the raw values.
3. After a successful profile LLM call, an **AI profile guidance** panel shows
   the authoritative goal status, short summary, change observations, numbered
   suggestion cards, relevant file chips, and whether the model used metrics
   only or metrics plus source files.
4. If the LLM call fails, the panel shows the safe backend error and continues
   displaying all raw assessment results.

LLM output is HTML-escaped before rendering. Paragraph breaks are preserved,
but model-generated HTML cannot execute in the webview.

## Files changed for this feature

| File | Responsibility |
| --- | --- |
| `apps/orchestrator/main.py` | Environment configuration, metric descriptions, prompt preparation, URL normalization, provider request, response parsing, and `/eval/explanation`. |
| `apps/orchestrator/test_main.py` | Unit tests for URL normalization, prompt contents, URL omission, and response extraction. |
| `apps/uiqlab-assessment/src/runAssessment.ts` | Client function that calls the orchestrator explanation endpoint and enforces the extension timeout. |
| `apps/uiqlab-assessment/src/extension.ts` | Calls the explanation function after assessment completion and renders success or failure states. |
| `apps/uiqlab-assessment/src/sourceContext.ts` | Selects and bounds opt-in frontend source context for profile suggestions. |
| `apps/uiqlab-assessment/src/assessmentSidebar.ts` | Stores and enforces the per-workspace source-sharing permission toggle. |
| `docker-compose.yml` | Passes LLM variables into the orchestrator container. |
| `.env.example` | Documents non-secret example configuration. |
| `.gitignore` | Keeps the real `.env` private while allowing `.env.example` to be committed. |

## Error handling and troubleshooting

### `LLM explanation is not configured`

Check that `LLM_API_URL`, `LLM_API_KEY`, and `LLM_MODEL` have non-empty values in
the root `.env`, then recreate the orchestrator container.

### HTTP 403 from the provider

Check whether the configured URL is a base URL or endpoint. The current
implementation handles both `/v1` and `/v1/chat/completions`. A continuing 403
usually means the key lacks access, the university requires VPN/proxy access,
or the provider uses authentication other than `Authorization: Bearer`.

### HTTP 502 in the webview

The provider rejected the request or returned a response without
`choices[0].message.content`. The webview now includes the provider HTTP status
when one is available.

### HTTP 504 or timeout

Verify the university VPN and endpoint availability. If the model legitimately
needs longer, increase `LLM_TIMEOUT_SECONDS` and recreate the orchestrator. The
extension currently waits 210 seconds, so keep the server timeout below that or
increase both values together.

### `httpx.ReadTimeout` while polling `/eval/result/...`

This can come from the separate UIQLab assessment backend rather than the LLM.
Look at the stack trace: calls through `get_eval_result()` and
`fetch_merged_backend_results()` concern metric polling; calls through
`explain_assessment()` concern the LLM provider.

## Tests

Run the extension checks:

```bash
cd apps/uiqlab-assessment
npm run check-types
npm run lint
npm run compile-tests
```

Run the orchestrator tests in an environment with its dependencies installed:

```bash
cd apps/orchestrator
python -m unittest test_main.py
```

The LLM unit tests do not make real provider requests. A live end-to-end check
requires valid `.env` credentials and a reachable provider.

## Current scope and likely next improvements

This is intentionally a basic version. It currently uses one synchronous LLM
request and renders one explanation for the full assessment. Reasonable future
improvements include caching explanations, adding a retry button, supporting
provider-specific authentication headers, using structured output, and adding
evaluation tests for explanation quality.
