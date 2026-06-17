from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import faiss
import numpy as np
from dotenv import load_dotenv
import os
import time
from google import genai
from chunker import chunk_repository
from github_handler import clone_repo, delete_repo, get_repo_name

load_dotenv()

app = FastAPI(title="Codebase Chat API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory storage per API key
stores = {}

TRANSIENT_GEMINI_ERRORS = (
    "429",
    "503",
    "RESOURCE_EXHAUSTED",
    "UNAVAILABLE",
)

def get_store(api_key: str):
    if api_key not in stores:
        stores[api_key] = {"index": None, "chunks": []}
    return stores[api_key]


def is_transient_gemini_error(error: Exception) -> bool:
    message = str(error)
    return any(code in message for code in TRANSIENT_GEMINI_ERRORS)


def retry_gemini_call(operation, description: str, max_attempts: int = 5):
    delay = 5
    for attempt in range(1, max_attempts + 1):
        try:
            return operation()
        except Exception as e:
            if not is_transient_gemini_error(e) or attempt == max_attempts:
                raise e

            print(
                f"Temporary Gemini error during {description}; "
                f"retrying in {delay}s (attempt {attempt}/{max_attempts})"
            )
            time.sleep(delay)
            delay = min(delay * 2, 30)


def raise_http_error(error: Exception):
    if is_transient_gemini_error(error):
        raise HTTPException(
            status_code=503,
            detail="Gemini is temporarily unavailable or rate limited. Please try again in a minute."
        )
    raise error


def get_embedding(text: str, api_key: str):
    client = genai.Client(api_key=api_key)
    result = retry_gemini_call(
        lambda: client.models.embed_content(
            model="models/gemini-embedding-001",
            contents=text
        ),
        "embedding"
    )
    return result.embeddings[0].values

def get_embeddings_batch(texts: list, api_key: str):
    """Embed texts in batches of 50 to stay within rate limits."""
    all_embeddings = []
    batch_size = 50
    for i in range(0, len(texts), batch_size):
        batch = texts[i:i+batch_size]
        print(f"Embedding batch {i//batch_size + 1} of {(len(texts)-1)//batch_size + 1}...")
        for text in batch:
            embedding = get_embedding(text, api_key)
            all_embeddings.append(embedding)
        if i + batch_size < len(texts):
            time.sleep(2)
    return all_embeddings

# ── Request/Response models ──────────────────────────────────────────────────

class IndexRequest(BaseModel):
    repo_path: str
    api_key: str

class GithubIndexRequest(BaseModel):
    github_url: str
    api_key: str

class QueryRequest(BaseModel):
    question: str
    api_key: str

class ChunkSource(BaseModel):
    file: str
    function_name: str
    start_line: int

class QueryResponse(BaseModel):
    answer: str
    sources: list[ChunkSource]

# ── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "running"}


@app.post("/index-github")
def index_github(request: GithubIndexRequest):
    repo_path = None
    try:
        repo_path = clone_repo(request.github_url.strip())
        repo_name = get_repo_name(request.github_url)

        chunks = chunk_repository(repo_path)

        if not chunks:
            raise HTTPException(status_code=400, detail="No Python functions found in this repo")

        # Limit to 100 chunks
        chunks = chunks[:100]

        texts = [chunk["text"] for chunk in chunks]
        embeddings = get_embeddings_batch(texts, request.api_key)
        embeddings = np.array(embeddings, dtype='float32')

        dimension = embeddings.shape[1]
        index = faiss.IndexFlatL2(dimension)
        index.add(embeddings)

        store = get_store(request.api_key)
        store["index"] = index
        store["chunks"] = chunks

        print(f"Indexed {len(chunks)} functions from {repo_name}")
        return {
            "status": "success",
            "repo": repo_name,
            "total_chunks": len(chunks),
            "files_indexed": len(set(c["file"] for c in chunks))
        }

    except Exception as e:
        raise_http_error(e)

    finally:
        if repo_path:
            delete_repo(repo_path)


@app.post("/query", response_model=QueryResponse)
def query(request: QueryRequest):
    store = get_store(request.api_key)

    if store["index"] is None:
        raise HTTPException(status_code=400, detail="No repo indexed yet. Call /index-github first.")

    client = genai.Client(api_key=request.api_key)

    try:
        q_embedding = np.array([get_embedding(request.question, request.api_key)], dtype='float32')
    except Exception as e:
        raise_http_error(e)

    distances, indices = store["index"].search(q_embedding, k=3)

    relevant_chunks = [store["chunks"][i] for i in indices[0]]
    context = ""
    for chunk in relevant_chunks:
        context += f"\n--- {chunk['file']} (lines {chunk['start_line']}-{chunk['end_line']}) ---\n"
        context += chunk["text"] + "\n"

    prompt = f"""You are a code assistant helping a developer understand a codebase.
Use ONLY the code snippets below to answer the question.
Always mention which file and function your answer comes from.

Code context:
{context}

Question: {request.question}

Answer clearly and mention the exact file and function name."""

    try:
        response = retry_gemini_call(
            lambda: client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt
            ),
            "answer generation"
        )
    except Exception as e:
        raise_http_error(e)

    sources = [
        ChunkSource(
            file=chunk["file"],
            function_name=chunk["function_name"],
            start_line=chunk["start_line"]
        )
        for chunk in relevant_chunks
    ]

    return QueryResponse(answer=response.text, sources=sources)
