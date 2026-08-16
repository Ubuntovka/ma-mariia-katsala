# Orchestrator and PostgreSQL Docker Setup

See [LLM-Based Assessment Explanations](docs/llm-explanation-integration.md)
for the implementation architecture, configuration, security model, and
troubleshooting guide.

See [CI Integration](docs/ci-integration.md) for pipeline triggers,
merge-request behavior, GitLab and GitHub examples, failure handling, and
troubleshooting. The [UIQLab CI client](apps/uiqlab-ci/README.md) also contains
a compact client reference.

This setup allows you to run the Orchestrator application and a PostgreSQL database using Docker Compose.

## Prerequisites

- Docker and Docker Compose installed on your machine.

## Configuration

Environment variables are managed in a `.env` file in the root directory.

1.  **Create `.env` file**: You can use the provided `.env.example` as a template.
    ```bash
    cp .env.example .env
    ```
2.  **Adjust variables**: Open the `.env` file and modify any values if necessary (e.g., database credentials or ports).

    To enable plain-language assessment explanations, set `LLM_API_URL`,
    `LLM_API_KEY`, and `LLM_MODEL`. The URL can be an OpenAI-compatible API base
    URL (such as one ending in `/v1`) or a full Chat Completions endpoint. These values are passed only to the orchestrator and
    are never included in extension or webview responses.

## Running the Services

To build and start the services, run the following command from the project root:

```bash
docker compose up --build
```

- **Orchestrator**: Available at `http://localhost:8181`
- **PostgreSQL**: Available at `localhost:5433` (isolated from `ma-rui-feng` setup)

To stop the services:

```bash
docker compose down
```
