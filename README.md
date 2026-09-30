# UIQLab

UIQLab assesses web interfaces from a VS Code extension or CI/CD pipeline. This
repository contains the orchestrator, PostgreSQL storage, the extension, and the
CI client. The metric-evaluation backend is a separate service.

## Installation

### Prerequisites

| Platform | Install |
| --- | --- |
| macOS | Git, Node.js 20.19+, VS Code 1.125+, and Docker Desktop |
| Linux | Git, Node.js 20.19+, VS Code 1.125+, Docker Engine, and the Docker Compose plugin |
| Windows | Git, Node.js 20.19+, VS Code 1.125+, and Docker Desktop with WSL 2 enabled |

Confirm that `git`, `node`, `npm`, `docker`, and `docker compose` are available
in your terminal. Start Docker Desktop first on macOS and Windows.

### 1. Get the project

```bash
git clone https://github.com/Ubuntovka/ma-mariia-katsala.git
cd ma-mariia-katsala
```

Install the extension and CI client dependencies:

```bash
npm ci --prefix apps/uiqlab-assessment
npm ci --prefix apps/uiqlab-ci
npx --prefix apps/uiqlab-assessment playwright-core install chromium
```

On Linux, install Chromium's system libraries if local capture fails:

```bash
npx --prefix apps/uiqlab-assessment playwright-core install-deps chromium
```

### 2. Configure the services

The orchestrator requires the separate metric-evaluation backend. Create its
shared Docker network once if it does not already exist:

```bash
docker network create thesis-network
```

Then start the backend on `thesis-network`.

Copy the environment template:

```bash
# macOS/Linux, Git Bash, or WSL
cp .env.example .env
```

```powershell
# Windows PowerShell
Copy-Item .env.example .env
```

Edit `.env` and set `BACKEND_URL` to the backend's Docker service name and port.
The default, `http://nginx`, assumes the backend uses the service name `nginx`
on `thesis-network`. `BACKEND_ARTIFACT_URL` must reach the backend's
`/input_files` and `/results` routes; its Docker Desktop default uses the
published evaluator port at `host.docker.internal:8001`. LLM settings are
optional and are needed only for AI explanations.

### 3. Start UIQLab

```bash
docker compose up --build -d
```

The orchestrator is available at <http://localhost:8181> and its API docs at
<http://localhost:8181/docs>. PostgreSQL is exposed on port `5433`.

Open `apps/uiqlab-assessment` in VS Code and press `F5` to build and launch the
extension. Its local-capture workflow expects the orchestrator at
`http://127.0.0.1:8181`.

Stop the services with:

```bash
docker compose down
```

## Development checks

```bash
npm test --prefix apps/uiqlab-assessment
npm test --prefix apps/uiqlab-ci
docker compose config --quiet
```

## Documentation

- [Assessment profiles](docs/assessment-profiles.md)
- [CI integration](docs/ci-integration.md)
- [LLM explanations](docs/llm-explanation-integration.md)
- [Extension usage](apps/uiqlab-assessment/README.md)
- [CI client reference](apps/uiqlab-ci/README.md)
