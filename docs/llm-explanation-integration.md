# LLM-based assessment explanations

UITend can turn metric results into a short structured explanation. Custom
assessments separate measured evidence, interpretation, and suggested actions.
Profile assessments explain the deterministic profile outcome and suggest
experiments related to the selected directions.

The explanation is advisory. Raw metrics and deterministic comparisons remain
authoritative.

## Data flow and privacy

The VS Code extension sends current results and compatible history to
`POST /eval/explanation` on the orchestrator. The orchestrator removes
unnecessary artifact URLs, bounds the payload, adds metric definitions, and
calls the configured OpenAI-compatible Chat Completions endpoint.

The provider URL, API key, and model are available only to the orchestrator.
They are stored in the root `.env`, which is ignored by Git, and are never
sent to the webview.

**Allow LLM to use source code (Demo)** is a separate opt-in setting and is off
by default. When enabled, the extension may send up to 10 frontend files,
limited to 24 KiB per file and 100 KiB total. Dependencies, generated output,
minified JavaScript, and source maps are excluded. The captured page HTML is
not used as source context.

Assessment data and any permitted source files are processed under the chosen
provider's terms and retention rules. Do not submit secrets, personal data, or
confidential code unless the provider is approved for that data.

## Configuration

Set these values in the root `.env`:

| Variable | Required | Purpose |
| --- | --- | --- |
| `LLM_API_URL` | Yes | Provider base URL or full Chat Completions URL. |
| `LLM_API_KEY` | Yes | Bearer token used by the orchestrator. |
| `LLM_MODEL` | Yes | Provider-specific model name. |
| `LLM_CONNECT_TIMEOUT_SECONDS` | No | Connection timeout; default `60`, minimum `10`. |
| `LLM_TIMEOUT_SECONDS` | No | Overall provider deadline; default `180`, minimum `10`. |

```dotenv
LLM_API_URL=https://provider.example/v1
LLM_API_KEY=replace-with-the-real-secret
LLM_MODEL=replace-with-the-model-name
LLM_CONNECT_TIMEOUT_SECONDS=60
LLM_TIMEOUT_SECONDS=180
```

The URL may end at the host, `/v1`, or `/v1/chat/completions`; the
orchestrator normalizes all three forms.

After changing `.env`, recreate the service:

```bash
docker compose up -d --build uitend-orchestrator
```

## Runtime behavior

1. The extension completes an assessment and requests compatible history.
2. It sends results, history, and profile context to the orchestrator.
3. If source sharing is enabled, it also sends the bounded source selection.
4. The orchestrator validates and reduces the payload, then calls the provider.
5. The webview escapes and displays the structured response above the raw
   metrics.

The sidebar's **Use LLM explanation** preference is stored per workspace and
defaults to disabled. When disabled, no explanation request is made. If the LLM
request fails, the raw assessment results remain available.

For profile runs, the deterministic outcome cannot be changed by the model.
For custom runs, the model receives material comparisons selected by fixed
thresholds. Explanations are not stored in PostgreSQL or used by quality gates.

## API

```http
POST /eval/explanation
Content-Type: application/json
```

Minimal request:

```json
{
  "currentResults": [
    {
      "metric_id": "m9_edge_density",
      "results": [0.24]
    }
  ]
}
```

Optional fields are:

- `history`: compatible previous metric results;
- `assessment`: custom or profile selection;
- `profileAssessment`: deterministic profile outcome;
- `target`: assessed URL;
- `sourceContext`: separately permitted `path` and `content` entries.

Successful responses contain `explanation` plus either `profileFeedback` or
`customFeedback`. Structured fields include the summary, observations or
findings, suggested actions, and the source paths actually used. Invented source
paths are removed.

### Response codes

| Status | Meaning |
| --- | --- |
| `400` | No current metric results were provided. |
| `502` | The provider rejected the request or returned an invalid response. |
| `503` | Required LLM configuration is missing. |
| `504` | The connection or provider response timed out. |

Provider credentials and raw response bodies are not included in client-facing
errors.

## Troubleshooting

| Problem | Check |
| --- | --- |
| LLM explanation is not configured | Set `LLM_API_URL`, `LLM_API_KEY`, and `LLM_MODEL`, then recreate the orchestrator. |
| HTTP 403 from the provider | Check the endpoint, API-key access, VPN, proxy, and authentication method. |
| HTTP 502 in the webview | Inspect the provider status; it rejected the request or returned an unsupported response. |
| HTTP 504 or timeout | Check provider reachability and increase the relevant timeout only if needed. |
| Timeout while polling `/eval/result/...` | Inspect the stack trace; this usually concerns the UIQLab backend rather than the LLM. |

Run the development checks listed in the repository
[README](../README.md#development-checks) after changing the integration.
