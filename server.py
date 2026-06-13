from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import faiss
import numpy as np
from sentence_transformers import SentenceTransformer
from dotenv import load_dotenv
import os
from google import genai
from chunker import chunk_repository

# Setup
load_dotenv()
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
embedder = SentenceTransformer("all-MiniLM-L6-v2")

# FastAPI app
app = FastAPI(title="Codebase Chat API")

# Allow React frontend to talk to this server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory storage — holds the index and chunks
# In production this would be a database
store = {
    "index": None,
    "chunks": []
}

# ── Request/Response models ──────────────────────────────────────────────────

class IndexRequest(BaseModel):
    repo_path: str  # path to the folder to index

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

    if not chunks:
        raise HTTPException(status_code=400, detail="No Python functions found in this path")

    # Embed all chunks
    texts = [chunk["text"] for chunk in chunks]
    embeddings = embedder.encode(texts)
    embeddings = np.array(embeddings, dtype='float32')

    # Build FAISS index
    dimension = embeddings.shape[1]
    index = faiss.IndexFlatL2(dimension)
    index.add(embeddings)

    # Save to store
    store["index"] = index
    store["chunks"] = chunks

    print(f"Indexed {len(chunks)} functions successfully")
    return {
        "status": "success",
        "total_chunks": len(chunks),
        "files_indexed": len(set(c["file"] for c in chunks))
    }


@app.post("/query", response_model=QueryResponse)
def query(request: QueryRequest):
    if store["index"] is None:
        raise HTTPException(status_code=400, detail="No repo indexed yet. Call /index first.")

    # Search FAISS
    q_embedding = np.array(embedder.encode([request.question]), dtype='float32')
    distances, indices = store["index"].search(q_embedding, k=3)

    # Build context
    relevant_chunks = [store["chunks"][i] for i in indices[0]]
    context = ""
    for chunk in relevant_chunks:
        context += f"\n--- {chunk['file']} (lines {chunk['start_line']}-{chunk['end_line']}) ---\n"
        context += chunk["text"] + "\n"

    # Ask Gemini
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

    # Build sources list
    sources = [
        ChunkSource(
            file=chunk["file"],
            function_name=chunk["function_name"],
            start_line=chunk["start_line"]
        )
        for chunk in relevant_chunks
    ]

    return QueryResponse(answer=response.text, sources=sources)