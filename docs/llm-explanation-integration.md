# LLM-Based Assessment Explanations

## Purpose

The LLM integration turns raw Web UI Assessment metric results into a short,
plain-language explanation for people who do not know the UIQLab metrics.

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
      | current results + available history
      v
Orchestrator (FastAPI)
      |
      | reads URL, key, model, and timeout from environment variables
      | sends an authenticated Chat Completions request
      v
University/OpenAI-compatible LLM provider
```

The provider URL and API key exist only in the root `.env` file and the
orchestrator container environment. They are not compiled into the extension,
sent to the webview, or returned by the explanation endpoint.

The root `.env` file is ignored by Git. `.env.example` contains only placeholder
configuration and is safe to commit.

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
3. It calls `fetchAssessmentExplanation()` with the current metric results and
   any returned history.
4. `fetchAssessmentExplanation()` sends the data to
   `POST /eval/explanation` on the orchestrator.
5. The orchestrator validates that LLM configuration and current results exist.
6. It reduces and sanitizes the assessment payload, adds metric definitions,
   and builds system and user messages.
7. It calls the provider using bearer authentication and the configured model.
8. It extracts `choices[0].message.content` from the OpenAI-compatible response
   and returns `{ "explanation": "..." }` to the extension.
9. The webview escapes the returned text and displays it above the raw metric
   results.

The extension sidebar includes a **Use LLM explanation** toggle. When enabled,
both deployment-URL and local-URL assessment flows request an explanation. When
disabled, no request is sent to the explanation endpoint and the results panel
shows the raw metric results without an explanation block. The preference is
stored per workspace and defaults to enabled to preserve the existing behavior.
History is included only when the history endpoint finds a comparable previous
run. Screenshot-based comparisons require matching screenshot dimensions.

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
  }
}
```

### Successful response

```json
{
  "explanation": "The page contains more detected edges than in the previous run..."
}
```

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

- A system message tells the model to write for a non-technical reader, start
  with an overall summary, explain important metrics and historical changes,
  avoid unsupported claims, and keep the answer below 450 words.
- A user message contains metric definitions, current results, and available
  previous results as JSON data.

`METRIC_EXPLANATIONS` provides short domain descriptions for metrics M1–M14.
This gives the model enough context to explain values such as edge density,
feature congestion, entropy, NIMA, and accessibility results without assuming
the reader already understands them.

The prompt explicitly instructs the model to treat assessment values as data,
not instructions. It also tells the model not to invent thresholds, causes, or
recommendations unsupported by the results.

## Payload reduction and privacy

Before assessment data is sent to the provider, `compact_llm_value()` applies
basic limits:

- artifact URLs are replaced with `[artifact URL omitted]`;
- strings are limited to 1,000 characters;
- lists and dictionaries are limited to 50 entries at each level;
- content nested deeper than six levels is omitted;
- the final serialized assessment data is limited to 30,000 characters.

The response is limited to 700 tokens in the provider request. The integration
does not currently cache explanations or store them in PostgreSQL; a new
explanation is requested for every completed assessment.

## Webview behavior

The results panel has three explanation states:

1. While assessment metrics are still arriving, no explanation block is shown.
2. After a successful LLM call, a **Plain-language explanation** section is
   rendered above the raw values.
3. If the LLM call fails, the panel shows the safe backend error and continues
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
