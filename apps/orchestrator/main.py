from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import httpx
import json
import os
import asyncpg
import re

app = FastAPI()

BACKEND_URL = os.getenv("BACKEND_URL", "http://nginx")
POSTGRES_USER = os.getenv("POSTGRES_USER", "orchestrator")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "orchestrator")
POSTGRES_DB = os.getenv("POSTGRES_DB", "orchestrator_db")
POSTGRES_HOST = os.getenv("POSTGRES_HOST", "orchestrator-postgres")


@app.on_event("startup")
async def startup_event():
    await init_db()


async def init_db():
    conn = await asyncpg.connect(
        user=POSTGRES_USER,
        password=POSTGRES_PASSWORD,
        database=POSTGRES_DB,
        host=POSTGRES_HOST
    )
    try:
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS project (
                id SERIAL PRIMARY KEY,
                project_name TEXT,
                "repositoryUrl" TEXT UNIQUE NOT NULL
            );
        ''')
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS assessment_run (
                id SERIAL PRIMARY KEY,
                project_id INTEGER REFERENCES project(id),
                source TEXT NOT NULL,
                branch TEXT,
                "commitHash" TEXT,
                "gitDirty" BOOLEAN,
                "mergeRequestId" TEXT,
                "assessedTarget" TEXT,
                "createdAt" TIMESTAMPTZ DEFAULT NOW()
            );
        ''')
    finally:
        await conn.close()


def normalize_repo_url(url: str) -> str:
    # Remove protocol and git@
    normalized = re.sub(r'^(https?://|git@)', '', url)
    # Replace : with / (for git@ format)
    normalized = normalized.replace(':', '/')
    # Remove .git suffix
    if normalized.endswith('.git'):
        normalized = normalized[:-4]
    # Remove trailing slashes and lowercase
    return normalized.lower().strip('/')


async def get_or_create_project(conn, repository_url: str, project_name: Optional[str]):
    normalized_url = normalize_repo_url(repository_url)
    project = await conn.fetchrow(
        'SELECT id FROM project WHERE "repositoryUrl" = $1',
        normalized_url
    )
    if project:
        return project['id']

    return await conn.fetchval(
        'INSERT INTO project (project_name, "repositoryUrl") VALUES ($1, $2) RETURNING id',
        project_name, normalized_url
    )


@app.get("/")
async def root():
    return {"message": "Hello World"}


@app.get("/eval/mm")
async def get_eval_mm():
    """Fetch data from {BACKEND_URL}/eval/mm and return the JSON response"""
    async with httpx.AsyncClient() as client:
        response = await client.get(f"{BACKEND_URL}/eval/mm")
        response.raise_for_status()  # Raise an error for bad status codes
        return response.json()


class EvaluateURLInput(BaseModel):
    url: str
    metrics: List[str]
    projectName: Optional[str] = None
    repositoryUrl: str
    source: str
    branch: Optional[str] = None
    commitHash: Optional[str] = None
    gitDirty: Optional[bool] = None
    mergeRequestId: Optional[str] = None


@app.post("/eval/evaluate_url_input_test")
async def post_evaluate_url_input_test(payload: EvaluateURLInput):
    """Accept a JSON body (url, metrics, and git info) from the caller,
    store it in the database, and forward it to
    {BACKEND_URL}/eval/evaluate_url_input. Returns the JSON response
    from the target service.
    """
    conn = await asyncpg.connect(
        user=POSTGRES_USER,
        password=POSTGRES_PASSWORD,
        database=POSTGRES_DB,
        host=POSTGRES_HOST
    )
    try:
        project_id = await get_or_create_project(conn, payload.repositoryUrl, payload.projectName)
        await conn.execute(
            '''
            INSERT INTO assessment_run (
                project_id, source, branch, "commitHash", "gitDirty", "mergeRequestId", "assessedTarget"
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            ''',
            project_id, payload.source, payload.branch, payload.commitHash,
            payload.gitDirty, payload.mergeRequestId, payload.url
        )
    finally:
        await conn.close()

    timeout = httpx.Timeout(
        connect=10.0,
        read=120.0,
        write=30.0,
        pool=10.0,
    )

    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(
            f"{BACKEND_URL}/eval/evaluate_url_input",
            json={
                "url": payload.url,
                "metrics": payload.metrics
            },
        )
        response.raise_for_status()
        return response.json()


@app.post("/eval/evaluate_with_artifacts")
async def evaluate_with_artifacts(
    file: UploadFile = File(...),
    mm: List[str] = Form(...),
    projectName: Optional[str] = Form(None),
    repositoryUrl: str = Form(...),
    source: str = Form(...),
    branch: Optional[str] = Form(None),
    commitHash: Optional[str] = Form(None),
    gitDirty: Optional[bool] = Form(None),
    mergeRequestId: Optional[str] = Form(None),
    assessedTarget: Optional[str] = Form(None),
):
    if not mm:
        raise HTTPException(status_code=400, detail="mm must be a non-empty metrics array")

    conn = await asyncpg.connect(
        user=POSTGRES_USER,
        password=POSTGRES_PASSWORD,
        database=POSTGRES_DB,
        host=POSTGRES_HOST
    )
    try:
        project_id = await get_or_create_project(conn, repositoryUrl, projectName)
        await conn.execute(
            '''
            INSERT INTO assessment_run (
                project_id, source, branch, "commitHash", "gitDirty", "mergeRequestId", "assessedTarget"
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            ''',
            project_id, source, branch, commitHash, gitDirty, mergeRequestId, assessedTarget or file.filename
        )
    finally:
        await conn.close()

    content_type = file.content_type
    # If content-type is generic, try to guess from filename to help the backend
    if content_type == "application/octet-stream" and file.filename:
        fn = file.filename.lower()
        if fn.endswith(".html") or fn.endswith(".htm"):
            content_type = "text/html"
        elif fn.endswith(".zip"):
            content_type = "application/zip"
        elif fn.endswith(".png"):
            content_type = "image/png"

    if content_type not in {"image/png", "text/html", "application/zip"}:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {content_type}")

    file_bytes = await file.read()

    timeout = httpx.Timeout(connect=10.0, read=120.0, write=30.0, pool=10.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        files = {
            "file": (file.filename or "uploaded", file_bytes, content_type),
        }
        data = {
            "mm": json.dumps({"metrics": mm})
        }
        try:
            resp = await client.post(f"{BACKEND_URL}/eval/evaluate_file_input", files=files, data=data)
            resp.raise_for_status()
            return resp.json()
        except httpx.RequestError as exc:
            raise HTTPException(status_code=503, detail=f"Failed to contact UIQLab backend: {exc}")
        except httpx.HTTPStatusError as exc:
            raise HTTPException(status_code=502, detail=f"UIQLab backend returned HTTP {exc.response.status_code}")

@app.get("/eval/result/{wui_id}")
async def get_eval_result(wui_id: str):
    """Fetch JSON from {BACKEND_URL}/eval/result/{wui_id}."""
    async with httpx.AsyncClient() as client:
        response = await client.get(f"{BACKEND_URL}/eval/result/{wui_id}")
        response.raise_for_status()
        return response.json()

