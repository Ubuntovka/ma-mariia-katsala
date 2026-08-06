from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from urllib.parse import urlsplit
from uuid import UUID
import asyncio
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

# These metrics need DOM/HTML input and cannot run from a PNG screenshot.
DOM_ONLY_FILE_METRICS = {"m8"}


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
                project_key UUID NOT NULL,
                project_name TEXT,
                "repositoryUrl" TEXT NOT NULL
            );
        ''')
        # Migrate databases created before project keys were introduced.
        await conn.execute('''
            ALTER TABLE project ADD COLUMN IF NOT EXISTS project_key UUID;
            UPDATE project SET project_key = gen_random_uuid() WHERE project_key IS NULL;
            ALTER TABLE project ALTER COLUMN project_key SET NOT NULL;
            ALTER TABLE project DROP CONSTRAINT IF EXISTS "project_repositoryUrl_key";
        ''')
        await conn.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_project_project_key ON project(project_key);')
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
                "backendResultId" TEXT,
                "backendResultIds" JSONB,
                status TEXT DEFAULT 'PENDING',
                success BOOLEAN,
                "metricsCount" INTEGER,
                "screenshotWidth" INTEGER,
                "screenshotHeight" INTEGER,
                "createdAt" TIMESTAMPTZ DEFAULT NOW()
            );
        ''')
        # Ensure columns exist for existing tables
        await conn.execute('''
            ALTER TABLE assessment_run ADD COLUMN IF NOT EXISTS "backendResultId" TEXT;
            ALTER TABLE assessment_run ADD COLUMN IF NOT EXISTS "backendResultIds" JSONB;
            ALTER TABLE assessment_run ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'PENDING';
            ALTER TABLE assessment_run ADD COLUMN IF NOT EXISTS success BOOLEAN;
            ALTER TABLE assessment_run ADD COLUMN IF NOT EXISTS "metricsCount" INTEGER;
            ALTER TABLE assessment_run ADD COLUMN IF NOT EXISTS "screenshotWidth" INTEGER;
            ALTER TABLE assessment_run ADD COLUMN IF NOT EXISTS "screenshotHeight" INTEGER;
            ALTER TABLE assessment_run DROP COLUMN IF EXISTS results;
        ''')
        await conn.execute('CREATE INDEX IF NOT EXISTS idx_assessment_run_backend_id ON assessment_run("backendResultId");')
        await conn.execute('''
            CREATE INDEX IF NOT EXISTS idx_assessment_run_history
            ON assessment_run(project_id, "assessedTarget", status, "createdAt" DESC);
        ''')
        await conn.execute('DROP INDEX IF EXISTS idx_assessment_run_m1_history;')
        await conn.execute('''
            CREATE INDEX IF NOT EXISTS idx_assessment_run_screenshot_history
            ON assessment_run(
                project_id, "assessedTarget", "screenshotWidth", "screenshotHeight",
                status, "createdAt" DESC
            );
        ''')

        # Keep existing runs comparable with newly normalized page paths.
        legacy_targets = await conn.fetch(
            '''
            SELECT id, "assessedTarget"
            FROM assessment_run
            WHERE "assessedTarget" ~ '^[A-Za-z][A-Za-z0-9+.-]*://'
            '''
        )
        for run in legacy_targets:
            normalized_target = normalize_assessed_target(run['assessedTarget'])
            if normalized_target != run['assessedTarget']:
                await conn.execute(
                    'UPDATE assessment_run SET "assessedTarget" = $1 WHERE id = $2',
                    normalized_target, run['id']
                )
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


def normalize_assessed_target(target: str) -> str:
    """Return a stable page path for URLs while leaving non-URL artifacts intact."""
    value = target.strip()
    parsed = urlsplit(value)
    if (parsed.scheme and parsed.netloc) or value.startswith('/'):
        path = parsed.path or '/'
        return path if path == '/' else path.rstrip('/')
    return value


async def get_or_create_project(
    conn,
    project_key: UUID,
    repository_url: str,
    project_name: Optional[str]
):
    normalized_url = normalize_repo_url(repository_url)
    return await conn.fetchval(
        '''
        INSERT INTO project (project_key, project_name, "repositoryUrl")
        VALUES ($1, $2, $3)
        ON CONFLICT (project_key) DO UPDATE SET
            project_name = COALESCE(EXCLUDED.project_name, project.project_name),
            "repositoryUrl" = EXCLUDED."repositoryUrl"
        RETURNING id
        ''',
        project_key, project_name, normalized_url
    )


async def update_assessment_run(
    run_id: int,
    backend_id: Optional[str] = None,
    backend_ids: Optional[List[str]] = None,
    status: Optional[str] = None,
    success: Optional[bool] = None
):
    conn = await asyncpg.connect(
        user=POSTGRES_USER,
        password=POSTGRES_PASSWORD,
        database=POSTGRES_DB,
        host=POSTGRES_HOST
    )
    try:
        if backend_id is not None and backend_ids is not None:
            await conn.execute(
                'UPDATE assessment_run SET "backendResultId" = $1, "backendResultIds" = $2::jsonb WHERE id = $3',
                backend_id, json.dumps(backend_ids), run_id
            )
        elif backend_id is not None and status is not None and success is not None:
            await conn.execute(
                'UPDATE assessment_run SET "backendResultId" = $1, status = $2, success = $3 WHERE id = $4',
                backend_id, status, success, run_id
            )
        elif backend_id is not None and status is not None:
            await conn.execute(
                'UPDATE assessment_run SET "backendResultId" = $1, status = $2 WHERE id = $3',
                backend_id, status, run_id
            )
        elif backend_id is not None:
            await conn.execute(
                'UPDATE assessment_run SET "backendResultId" = $1 WHERE id = $2',
                backend_id, run_id
            )
        elif status is not None and success is not None:
            await conn.execute(
                'UPDATE assessment_run SET status = $1, success = $2 WHERE id = $3',
                status, success, run_id
            )
        elif status is not None:
            await conn.execute(
                'UPDATE assessment_run SET status = $1 WHERE id = $2',
                status, run_id
            )
    finally:
        await conn.close()


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
    projectKey: UUID
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
    run_id = None
    try:
        project_id = await get_or_create_project(
            conn, payload.projectKey, payload.repositoryUrl, payload.projectName
        )
        run_id = await conn.fetchval(
            '''
            INSERT INTO assessment_run (
                project_id, source, branch, "commitHash", "gitDirty", "mergeRequestId", "assessedTarget", "metricsCount"
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id
            ''',
            project_id, payload.source, payload.branch, payload.commitHash,
            payload.gitDirty, payload.mergeRequestId, normalize_assessed_target(payload.url), len(payload.metrics)
        )
    finally:
        await conn.close()

    timeout = httpx.Timeout(
        connect=10.0,
        read=120.0,
        write=30.0,
        pool=10.0,
    )

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                f"{BACKEND_URL}/eval/evaluate_url_input",
                json={
                    "url": payload.url,
                    "metrics": payload.metrics
                },
            )
            response.raise_for_status()
            resp_json = response.json()
            backend_id = resp_json.get("result_id")
            if run_id and backend_id:
                await update_assessment_run(run_id, backend_id=backend_id)
            return resp_json
    except Exception as exc:
        if run_id:
            await update_assessment_run(run_id, status='FAILED')
        if isinstance(exc, httpx.HTTPStatusError):
            raise HTTPException(status_code=502, detail=f"UIQLab backend returned HTTP {exc.response.status_code}")
        raise HTTPException(status_code=503, detail=f"Failed to contact UIQLab backend: {exc}")


@app.post("/eval/evaluate_with_artifacts")
async def evaluate_with_artifacts(
    file: UploadFile = File(...),
    html: Optional[UploadFile] = File(None),
    mm: List[str] = Form(...),
    projectKey: UUID = Form(...),
    projectName: Optional[str] = Form(None),
    repositoryUrl: str = Form(...),
    source: str = Form(...),
    branch: Optional[str] = Form(None),
    commitHash: Optional[str] = Form(None),
    gitDirty: Optional[bool] = Form(None),
    mergeRequestId: Optional[str] = Form(None),
    assessedTarget: Optional[str] = Form(None),
    screenshotWidth: Optional[int] = Form(None),
    screenshotHeight: Optional[int] = Form(None),
):
    if not mm:
        raise HTTPException(status_code=400, detail="mm must be a non-empty metrics array")
    if (screenshotWidth is None) != (screenshotHeight is None):
        raise HTTPException(status_code=400, detail="Both screenshot dimensions must be provided together")
    if screenshotWidth is not None and (screenshotWidth <= 0 or screenshotHeight <= 0):
        raise HTTPException(status_code=400, detail="Screenshot dimensions must be positive integers")

    png_metrics, html_metrics = split_file_metrics(mm)
    if html_metrics and html is None:
        raise HTTPException(
            status_code=400,
            detail=f"Metrics {html_metrics} require the captured HTML artifact"
        )

    conn = await asyncpg.connect(
        user=POSTGRES_USER,
        password=POSTGRES_PASSWORD,
        database=POSTGRES_DB,
        host=POSTGRES_HOST
    )
    run_id = None
    try:
        project_id = await get_or_create_project(conn, projectKey, repositoryUrl, projectName)
        run_id = await conn.fetchval(
            '''
            INSERT INTO assessment_run (
                project_id, source, branch, "commitHash", "gitDirty", "mergeRequestId", "assessedTarget",
                "metricsCount", "screenshotWidth", "screenshotHeight"
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id
            ''',
            project_id, source, branch, commitHash, gitDirty, mergeRequestId,
            normalize_assessed_target(assessedTarget) if assessedTarget else file.filename,
            len(mm), screenshotWidth, screenshotHeight
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
    html_bytes = await html.read() if html is not None else None

    timeout = httpx.Timeout(connect=10.0, read=120.0, write=30.0, pool=10.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            submissions = []
            if png_metrics:
                submissions.append(client.post(
                    f"{BACKEND_URL}/eval/evaluate_file_input",
                    files={"file": (file.filename or "capture.png", file_bytes, content_type)},
                    data={"mm": json.dumps({"metrics": png_metrics})}
                ))
            if html_metrics and html_bytes is not None:
                submissions.append(client.post(
                    f"{BACKEND_URL}/eval/evaluate_file_input",
                    files={"file": (html.filename or "capture.html", html_bytes, "text/html")},
                    data={"mm": json.dumps({"metrics": html_metrics})}
                ))

            responses = await asyncio.gather(*submissions)
            for response in responses:
                response.raise_for_status()
            response_json = [response.json() for response in responses]
            backend_ids = [
                response["result_id"] for response in response_json if response.get("result_id")
            ]
            if not backend_ids:
                raise ValueError("UIQLab backend did not return a result_id")

            # The first ID remains the public tracking ID; result polling merges
            # every backend evaluation associated with this assessment run.
            resp_json = response_json[0]
            if run_id:
                await update_assessment_run(
                    run_id, backend_id=backend_ids[0], backend_ids=backend_ids
                )
            return resp_json
        except Exception as exc:
            if run_id:
                await update_assessment_run(run_id, status='FAILED')
            if isinstance(exc, httpx.HTTPStatusError):
                raise HTTPException(status_code=502, detail=f"UIQLab backend returned HTTP {exc.response.status_code}")
            raise HTTPException(status_code=503, detail=f"Failed to contact UIQLab backend: {exc}")

@app.get("/eval/result/{wui_id}")
async def get_eval_result(wui_id: str):
    """Fetch and merge all backend evaluations belonging to this run."""
    conn = await asyncpg.connect(
        user=POSTGRES_USER,
        password=POSTGRES_PASSWORD,
        database=POSTGRES_DB,
        host=POSTGRES_HOST
    )
    try:
        run = await conn.fetchrow(
            '''
            SELECT id, "metricsCount", status, "backendResultIds"
            FROM assessment_run
            WHERE "backendResultId" = $1
            ''',
            wui_id
        )
    finally:
        await conn.close()

    backend_ids = backend_result_ids_for_run(run, wui_id)

    async with httpx.AsyncClient() as client:
        results = await fetch_merged_backend_results(client, backend_ids)

        # Update database with status/success if finished
        conn = await asyncpg.connect(
            user=POSTGRES_USER,
            password=POSTGRES_PASSWORD,
            database=POSTGRES_DB,
            host=POSTGRES_HOST
        )
        try:
            if run and run['status'] == 'PENDING':
                # results is a list of {metric_id, results: []}
                completed_metric_count = len({
                    result['metric_id'].split('_')[0]
                    for result in results
                    if isinstance(result, dict) and isinstance(result.get('metric_id'), str)
                })
                if completed_metric_count >= run['metricsCount']:
                    # All metrics evaluated (some might have failed with empty results)
                    all_success = all(
                        isinstance(result, dict)
                        and isinstance(result.get('results'), list)
                        and len(result['results']) > 0
                        for result in results
                    )
                    await conn.execute(
                        'UPDATE assessment_run SET status = $1, success = $2 WHERE id = $3',
                        'COMPLETED', all_success, run['id']
                    )
        finally:
            await conn.close()

        return results


def metric_result_index(results):
    """Index result entries by exact metric id, preferring non-empty values."""
    indexed = {}
    if not isinstance(results, list):
        return indexed
    for result in results:
        if not isinstance(result, dict) or not isinstance(result.get('metric_id'), str):
            continue
        metric_id = result['metric_id']
        existing = indexed.get(metric_id)
        has_values = isinstance(result.get('results'), list) and len(result['results']) > 0
        existing_has_values = (
            isinstance(existing, dict)
            and isinstance(existing.get('results'), list)
            and len(existing['results']) > 0
        )
        if existing is None or (has_values and not existing_has_values):
            indexed[metric_id] = result
    return indexed


def metric_family(metric_id: str) -> str:
    return metric_id.split('_', 1)[0]


def decode_backend_result_ids(value) -> List[str]:
    """Decode asyncpg's JSONB string representation into backend IDs."""
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return []
    if not isinstance(value, list):
        return []
    return [backend_id for backend_id in value if isinstance(backend_id, str)]


def backend_result_ids_for_run(run, fallback_id: Optional[str] = None) -> List[str]:
    """Return all backend jobs for a run, with legacy single-ID fallback."""
    backend_ids = decode_backend_result_ids(run['backendResultIds']) if run else []
    if backend_ids:
        return backend_ids
    try:
        primary_id = run['backendResultId'] if run else None
    except KeyError:
        primary_id = None
    if primary_id:
        return [primary_id]
    return [fallback_id] if fallback_id else []


async def fetch_merged_backend_results(client, backend_ids: List[str]):
    """Fetch transient UIQLab results for every job and merge them by metric ID."""
    responses = await asyncio.gather(*[
        client.get(f"{BACKEND_URL}/eval/result/{backend_id}")
        for backend_id in backend_ids
    ])
    for response in responses:
        response.raise_for_status()
    return merge_metric_results(*[response.json() for response in responses])


def split_file_metrics(metrics: List[str]):
    """Keep screenshot metrics on PNG and route DOM-only metrics to HTML."""
    png_metrics = []
    html_metrics = []
    for metric_id in metrics:
        target = html_metrics if metric_family(metric_id) in DOM_ONLY_FILE_METRICS else png_metrics
        target.append(metric_id)
    return png_metrics, html_metrics


def merge_metric_results(*result_sets):
    """Merge backend result lists, preferring a non-empty duplicate result."""
    merged = {}
    order = []
    for results in result_sets:
        for metric_id, result in metric_result_index(results).items():
            if metric_id not in merged:
                order.append(metric_id)
            existing = merged.get(metric_id)
            has_values = isinstance(result.get('results'), list) and bool(result['results'])
            existing_has_values = (
                isinstance(existing, dict)
                and isinstance(existing.get('results'), list)
                and bool(existing['results'])
            )
            if existing is None or (has_values and not existing_has_values):
                merged[metric_id] = result
    return [merged[metric_id] for metric_id in order]


@app.get("/eval/result/{wui_id}/history")
async def get_eval_result_history(wui_id: str):
    """Return dimension-matched screenshot-metric history for the same project and page."""
    conn = await asyncpg.connect(
        user=POSTGRES_USER,
        password=POSTGRES_PASSWORD,
        database=POSTGRES_DB,
        host=POSTGRES_HOST
    )
    try:
        current = await conn.fetchrow(
            '''
            SELECT id, project_id, "assessedTarget", "backendResultId", "backendResultIds", status,
                   "screenshotWidth", "screenshotHeight"
            FROM assessment_run
            WHERE "backendResultId" = $1
            ''',
            wui_id
        )
        if (
            not current
            or current['status'] != 'COMPLETED'
            or current['screenshotWidth'] is None
            or current['screenshotHeight'] is None
        ):
            return {'metrics': {}}

        async with httpx.AsyncClient() as client:
            try:
                current_results = await fetch_merged_backend_results(
                    client,
                    backend_result_ids_for_run(current)
                )
            except (httpx.HTTPError, ValueError):
                return {'metrics': {}}

        outstanding_metric_ids = {
            metric_id
            for metric_id in metric_result_index(current_results)
            if metric_id.split('_')[0] in {'m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11', 'm12', 'm13', 'm14'}
        }
        if not outstanding_metric_ids:
            return {'metrics': {}}

        previous_runs = await conn.fetch(
            '''
            SELECT id, "backendResultId", "backendResultIds", "createdAt"
            FROM assessment_run
            WHERE project_id = $1
              AND "assessedTarget" = $2
              AND status = 'COMPLETED'
              AND "screenshotWidth" = $4
              AND "screenshotHeight" = $5
              AND id <> $3
              AND ("createdAt", id) < (
                  SELECT "createdAt", id FROM assessment_run WHERE id = $3
              )
            ORDER BY "createdAt" DESC, id DESC
            LIMIT 50
            ''',
            current['project_id'], current['assessedTarget'], current['id'],
            current['screenshotWidth'], current['screenshotHeight']
        )

        history = {}
        async with httpx.AsyncClient() as client:
            for previous_run in previous_runs:
                previous_backend_ids = backend_result_ids_for_run(previous_run)
                if not previous_backend_ids:
                    continue
                try:
                    previous_results = await fetch_merged_backend_results(
                        client,
                        previous_backend_ids
                    )
                except (httpx.HTTPError, ValueError):
                    continue

                for metric_id, result in metric_result_index(previous_results).items():
                    if metric_id not in outstanding_metric_ids:
                        continue
                    history[metric_id] = {
                        'results': result.get('results'),
                        'createdAt': previous_run['createdAt'].isoformat()
                    }
                    outstanding_metric_ids.remove(metric_id)

                if not outstanding_metric_ids:
                    break

        return {
            'metrics': history,
            'screenshotDimensions': {
                'width': current['screenshotWidth'],
                'height': current['screenshotHeight']
            }
        }
    finally:
        await conn.close()
