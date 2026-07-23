from fastapi import FastAPI
from pydantic import BaseModel
from typing import List
import httpx

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


@app.get("/eval/result/{wui_id}")
async def get_eval_result(wui_id: str):
    """Fetch JSON from http://localhost:8001/eval/result/{wui_id}."""
    async with httpx.AsyncClient() as client:
        response = await client.get(f"http://127.0.0.1:8001/eval/result/{wui_id}")
        response.raise_for_status()
        return response.json()


