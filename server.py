from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import faiss
import numpy as np
from dotenv import load_dotenv
import os
import time
import hashlib
import json
import urllib.request
import uuid
from google import genai
from chunker import chunk_repository
from github_handler import clone_repo, delete_repo, get_repo_name
from database import (
    init_db,
    get_or_create_user,
    create_session,
    get_user_sessions,
    get_session,
    delete_session,
    update_session_repo,
    add_message,
    get_session_messages,
)

load_dotenv()

app = FastAPI(title="Codebase Chat API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory storage for active FAISS stores (mapped by repo_url)
stores = {}

INDEX_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "indexes")

TRANSIENT_GEMINI_ERRORS = (
    "429",
    "503",
    "RESOURCE_EXHAUSTED",
    "UNAVAILABLE",
)

AUTH_GEMINI_ERRORS = (
    "401",
    "UNAUTHENTICATED",
    "ACCESS_TOKEN_TYPE_UNSUPPORTED",
    "API_KEY_INVALID",
)

# Initialize database on startup
@app.on_event("startup")
def startup_event():
    init_db()

def get_api_key() -> str:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="Server is missing GEMINI_API_KEY."
        )
    return api_key


def is_transient_gemini_error(error: Exception) -> bool:
    message = str(error)
    return any(code in message for code in TRANSIENT_GEMINI_ERRORS)


def is_auth_gemini_error(error: Exception) -> bool:
    message = str(error)
    return any(code in message for code in AUTH_GEMINI_ERRORS)


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
    if isinstance(error, HTTPException):
        raise error
    if is_auth_gemini_error(error):
        raise HTTPException(
            status_code=401,
            detail="The server GEMINI_API_KEY is invalid. Use an API key from Google AI Studio, not an OAuth token."
        )
    if is_transient_gemini_error(error):
        raise HTTPException(
            status_code=503,
            detail="Gemini is temporarily unavailable or rate limited. Please try again in a minute."
        )
    if "Failed to clone repo" in str(error):
        raise HTTPException(
            status_code=400,
            detail="Failed to clone repository. Please make sure you provided a valid, public GitHub repository URL (e.g., https://github.com/username/repository) and not a deployed website URL."
        )
    raise HTTPException(
        status_code=500,
        detail=f"Internal Server Error: {str(error)}"
    )


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
    client = genai.Client(api_key=api_key)
    for i in range(0, len(texts), batch_size):
        batch = texts[i:i+batch_size]
        print(f"Embedding batch {i//batch_size + 1} of {(len(texts)-1)//batch_size + 1}...")
        result = retry_gemini_call(
            lambda: client.models.embed_content(
                model="models/gemini-embedding-001",
                contents=batch
            ),
            "batch embedding"
        )
        for embedding in result.embeddings:
            all_embeddings.append(embedding.values)
        if i + batch_size < len(texts):
            time.sleep(2)
    return all_embeddings

# ── Index caching helper functions ──────────────────────────────────────────

def get_repo_hash(repo_url: str) -> str:
    return hashlib.sha256(repo_url.strip().encode("utf-8")).hexdigest()

def get_cached_index(repo_url: str):
    """Get index from memory or load it from disk if cached."""
    repo_url_clean = repo_url.strip()
    if repo_url_clean in stores:
        return stores[repo_url_clean]
    
    # Check disk cache
    repo_hash = get_repo_hash(repo_url_clean)
    repo_dir = os.path.join(INDEX_DIR, repo_hash)
    index_file = os.path.join(repo_dir, "index.faiss")
    chunks_file = os.path.join(repo_dir, "chunks.json")
    
    if os.path.exists(index_file) and os.path.exists(chunks_file):
        try:
            print(f"Loading cached index for {repo_url_clean} from disk...")
            index = faiss.read_index(index_file)
            with open(chunks_file, "r", encoding="utf-8") as f:
                chunks = json.load(f)
            
            stores[repo_url_clean] = {"index": index, "chunks": chunks}
            return stores[repo_url_clean]
        except Exception as e:
            print(f"Failed to load cached index from disk: {e}")
            
    return None

def save_index_to_disk(repo_url: str, index, chunks):
    """Save index and chunks to disk cache."""
    repo_url_clean = repo_url.strip()
    repo_hash = get_repo_hash(repo_url_clean)
    repo_dir = os.path.join(INDEX_DIR, repo_hash)
    os.makedirs(repo_dir, exist_ok=True)
    
    index_file = os.path.join(repo_dir, "index.faiss")
    chunks_file = os.path.join(repo_dir, "chunks.json")
    
    faiss.write_index(index, index_file)
    with open(chunks_file, "w", encoding="utf-8") as f:
        json.dump(chunks, f, indent=2)
    
    print(f"Saved index for {repo_url_clean} to disk at {repo_dir}")

# ── User authentication helpers ──────────────────────────────────────────────

def verify_google_token(token: str) -> dict:
    url = f"https://oauth2.googleapis.com/tokeninfo?id_token={token}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "FastAPI-Server"})
        with urllib.request.urlopen(req, timeout=5) as response:
            data = json.loads(response.read().decode("utf-8"))
            if "email" in data:
                return {
                    "email": data.get("email"),
                    "name": data.get("name"),
                    "picture": data.get("picture"),
                }
    except Exception as e:
        print(f"Token verification error: {e}")
    return None

def get_current_user(authorization: str = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    
    token = authorization.split(" ")[1]
    if token.startswith("demo:"):
        email = token.split("demo:")[1]
        if not email or "@" not in email:
            raise HTTPException(status_code=401, detail="Invalid demo token")
        name = email.split("@")[0].capitalize()
        user = get_or_create_user(email, name=name)
        return user
    else:
        user_info = verify_google_token(token)
        if not user_info:
            raise HTTPException(status_code=401, detail="Invalid Google OAuth token")
        user = get_or_create_user(user_info["email"], name=user_info.get("name"), picture=user_info.get("picture"))
        return user

# ── Request/Response models ──────────────────────────────────────────────────

class AuthRequest(BaseModel):
    token: str

class GithubIndexRequest(BaseModel):
    github_url: str

class CreateSessionRequest(BaseModel):
    repo_url: str = None
    repo_name: str = None
    title: str = None

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
    return {"status": "running"}

@app.post("/auth/login")
def auth_login(req: AuthRequest):
    token = req.token
    if token.startswith("demo:"):
        email = token.split("demo:")[1]
        if not email or "@" not in email:
            raise HTTPException(status_code=400, detail="Invalid email address")
        name = email.split("@")[0].capitalize()
        user = get_or_create_user(email, name=name)
        return {"status": "success", "user": user, "token": token}
    else:
        user_info = verify_google_token(token)
        if not user_info:
            raise HTTPException(status_code=401, detail="Invalid Google OAuth token")
        user = get_or_create_user(user_info["email"], name=user_info.get("name"), picture=user_info.get("picture"))
        return {"status": "success", "user": user, "token": token}

@app.get("/sessions")
def list_sessions(user: dict = Depends(get_current_user)):
    return get_user_sessions(user["id"])

@app.post("/sessions")
def api_create_session(req: CreateSessionRequest, user: dict = Depends(get_current_user)):
    session_id = str(uuid.uuid4())
    title = req.title or (f"Chat on {req.repo_name}" if req.repo_name else "New Chat")
    session = create_session(session_id, user["id"], req.repo_url, req.repo_name, title)
    return session

@app.delete("/sessions/{session_id}")
def api_delete_session(session_id: str, user: dict = Depends(get_current_user)):
    session = get_session(session_id)
    if not session or session["user_id"] != user["id"]:
        raise HTTPException(status_code=404, detail="Session not found")
    delete_session(session_id)
    return {"status": "success"}

@app.get("/sessions/{session_id}/messages")
def api_session_messages(session_id: str, user: dict = Depends(get_current_user)):
    session = get_session(session_id)
    if not session or session["user_id"] != user["id"]:
        raise HTTPException(status_code=404, detail="Session not found")
    messages = get_session_messages(session_id)
    return messages

@app.post("/sessions/{session_id}/index")
def index_session_repo(session_id: str, request: GithubIndexRequest, user: dict = Depends(get_current_user)):
    session = get_session(session_id)
    if not session or session["user_id"] != user["id"]:
        raise HTTPException(status_code=404, detail="Session not found")
        
    repo_path = None
    try:
        api_key = get_api_key()
        github_url = request.github_url.strip()
        repo_name = get_repo_name(github_url)
        
        # Check if already cached (memory or disk)
        cached = get_cached_index(github_url)
        if cached:
            # Update session in DB
            title = f"Chat on {repo_name}"
            update_session_repo(session_id, github_url, repo_name, title=title)
            return {
                "status": "success",
                "repo": repo_name,
                "total_chunks": len(cached["chunks"]),
                "files_indexed": len(set(c["file"] for c in cached["chunks"]))
            }
            
        repo_path = clone_repo(github_url)
        chunks = chunk_repository(repo_path)

        if not chunks:
            raise HTTPException(status_code=400, detail="No Python functions found in this repo")

        # Limit to 100 chunks
        chunks = chunks[:100]

        texts = [chunk["text"] for chunk in chunks]
        embeddings = get_embeddings_batch(texts, api_key)
        embeddings = np.array(embeddings, dtype='float32')

        dimension = embeddings.shape[1]
        index = faiss.IndexFlatL2(dimension)
        index.add(embeddings)

        # Save to disk cache and memory
        save_index_to_disk(github_url, index, chunks)
        stores[github_url] = {"index": index, "chunks": chunks}

        # Update session info
        title = f"Chat on {repo_name}"
        update_session_repo(session_id, github_url, repo_name, title=title)

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

@app.post("/sessions/{session_id}/query", response_model=QueryResponse)
def api_query_session(session_id: str, request: QueryRequest, user: dict = Depends(get_current_user)):
    session = get_session(session_id)
    if not session or session["user_id"] != user["id"]:
        raise HTTPException(status_code=404, detail="Session not found")
        
    repo_url = session["repo_url"]
    if not repo_url:
        raise HTTPException(status_code=400, detail="No repository indexed for this session. Please index a GitHub repository first.")
        
    # Get index from cache (disk or memory)
    store = get_cached_index(repo_url)
    if not store or store["index"] is None:
        raise HTTPException(
            status_code=400,
            detail=f"Repository index not found. Please re-index the repository: {repo_url}"
        )
        
    api_key = get_api_key()
    client = genai.Client(api_key=api_key)

    try:
        q_embedding = np.array([get_embedding(request.question, api_key)], dtype='float32')
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

    # Save user message and bot response to database
    add_message(session_id, "user", request.question)
    add_message(session_id, "bot", response.text, [dict(s) for s in sources])

    return QueryResponse(answer=response.text, sources=sources)
