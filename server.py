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

# Setup
load_dotenv()
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

# Gemini embedding function — no local model needed
def get_embedding(text):
    while True:
        try:
            result = client.models.embed_content(
                model="models/gemini-embedding-001",
                contents=text
            )
            return result.embeddings[0].values
        except Exception as e:
            if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
                print("Rate limit hit, waiting 30 seconds...")
                time.sleep(30)
            else:
                raise e
# FastAPI app
app = FastAPI(title="Codebase Chat API")

# Allow React frontend to talk to this server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory storage
store = {
    "index": None,
    "chunks": []
}

# ── Request/Response models ──────────────────────────────────────────────────

class IndexRequest(BaseModel):
    repo_path: str

class GithubIndexRequest(BaseModel):
    github_url: str

class QueryRequest(BaseModel):
    question: str

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
    return {
        "status": "running",
        "indexed": store["index"] is not None,
        "total_chunks": len(store["chunks"])
    }


@app.post("/index")
def index_repo(request: IndexRequest):
    if not os.path.exists(request.repo_path):
        raise HTTPException(status_code=404, detail=f"Path not found: {request.repo_path}")

    print(f"\nIndexing {request.repo_path}...")
    chunks = chunk_repository(request.repo_path)
    chunks = chunks[:200]
    if not chunks:
        raise HTTPException(status_code=400, detail="No Python functions found in this path")

    texts = [chunk["text"] for chunk in chunks]
    print("Embedding chunks...")
    embeddings = np.array([get_embedding(t) for t in texts], dtype='float32')

    dimension = embeddings.shape[1]
    index = faiss.IndexFlatL2(dimension)
    index.add(embeddings)

    store["index"] = index
    store["chunks"] = chunks

    return {
        "status": "success",
        "total_chunks": len(chunks),
        "files_indexed": len(set(c["file"] for c in chunks))
    }


@app.post("/index-github")
def index_github(request: GithubIndexRequest):
    repo_path = None
    try:
        repo_path = clone_repo(request.github_url.strip())
        repo_name = get_repo_name(request.github_url)

        chunks = chunk_repository(repo_path)
        # Limit to 200 chunks for free tier API limits
        chunks = chunks[:200]

        if not chunks:
            raise HTTPException(status_code=400, detail="No Python functions found in this repo")

        texts = [chunk["text"] for chunk in chunks]
        print(f"Embedding {len(texts)} chunks...")
        embeddings = np.array([get_embedding(t) for t in texts], dtype='float32')

        dimension = embeddings.shape[1]
        index = faiss.IndexFlatL2(dimension)
        index.add(embeddings)

        store["index"] = index
        store["chunks"] = chunks

        print(f"Indexed {len(chunks)} functions from {repo_name}")
        return {
            "status": "success",
            "repo": repo_name,
            "total_chunks": len(chunks),
            "files_indexed": len(set(c["file"] for c in chunks))
        }

    finally:
        if repo_path:
            delete_repo(repo_path)


@app.post("/query", response_model=QueryResponse)
def query(request: QueryRequest):
    if store["index"] is None:
        raise HTTPException(status_code=400, detail="No repo indexed yet. Call /index first.")

    q_embedding = np.array([get_embedding(request.question)], dtype='float32')
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

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt
    )

    sources = [
        ChunkSource(
            file=chunk["file"],
            function_name=chunk["function_name"],
            start_line=chunk["start_line"]
        )
        for chunk in relevant_chunks
    ]

    return QueryResponse(answer=response.text, sources=sources)