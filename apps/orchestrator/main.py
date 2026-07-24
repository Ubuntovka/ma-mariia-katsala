from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from pydantic import BaseModel
from typing import List
import httpx
import json

app = FastAPI()


@app.get("/")
async def root():
    return {"message": "Hello World"}


@app.get("/eval/mm")
async def get_eval_mm():
    """Fetch data from http://localhost:8001/eval/mm and return the JSON response"""
    async with httpx.AsyncClient() as client:
        response = await client.get("http://localhost:8001/eval/mm")
        response.raise_for_status()  # Raise an error for bad status codes
        return response.json()


class EvaluateURLInput(BaseModel):
    url: str
    metrics: List[str]


@app.post("/eval/evaluate_url_input_test")
async def post_evaluate_url_input_test(payload: EvaluateURLInput):
    """Accept a JSON body (url, metrics) from the caller and forward it to
    http://localhost:8001/eval/evaluate_url_input. Returns the JSON response
    from the target service.
    """
    timeout = httpx.Timeout(
        connect=10.0,
        read=120.0,
        write=30.0,
        pool=10.0,
    )

    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(
            "http://localhost:8001/eval/evaluate_url_input",
            json=payload.model_dump(),
        )
        response.raise_for_status()
        return response.json()

@app.post("/eval/evaluate_with_artifacts")
async def evaluate_with_artifacts(
    file: UploadFile = File(...),
    mm: List[str] = Form(...),
):
    if not mm:
        raise HTTPException(status_code=400, detail="mm must be a non-empty metrics array")

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
            resp = await client.post("http://localhost:8001/eval/evaluate_file_input", files=files, data=data)
            resp.raise_for_status()
            return resp.json()
        except httpx.RequestError as exc:
            raise HTTPException(status_code=503, detail=f"Failed to contact UIQLab backend: {exc}")
        except httpx.HTTPStatusError as exc:
            raise HTTPException(status_code=502, detail=f"UIQLab backend returned HTTP {exc.response.status_code}")

@app.get("/eval/result/{wui_id}")
async def get_eval_result(wui_id: str):
    """Fetch JSON from http://localhost:8001/eval/result/{wui_id}."""
    async with httpx.AsyncClient() as client:
        response = await client.get(f"http://127.0.0.1:8001/eval/result/{wui_id}")
        response.raise_for_status()
        return response.json()

