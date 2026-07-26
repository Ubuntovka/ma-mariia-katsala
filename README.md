# Orchestrator and PostgreSQL Docker Setup

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
