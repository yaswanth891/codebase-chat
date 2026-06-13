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

def build_index(repo_path):
    """
    Chunks a repo, embeds every chunk, stores in FAISS.
    Returns the index + original chunks list.
    """
    print(f"\nIndexing {repo_path}...")
    chunks = chunk_repository(repo_path)
    print(f"Total functions found: {len(chunks)}")

    # Embed every chunk's text
    print("Embedding chunks...")
    texts = [chunk["text"] for chunk in chunks]
    embeddings = embedder.encode(texts, show_progress_bar=True)
    embeddings = np.array(embeddings, dtype='float32')

    # Store in FAISS
    dimension = embeddings.shape[1]
    index = faiss.IndexFlatL2(dimension)
    index.add(embeddings)
    print(f"Index built with {index.ntotal} vectors\n")

    return index, chunks


def search(question, index, chunks, top_k=3):
    """
    Embeds the question, finds top_k most relevant chunks.
    """
    q_embedding = np.array(embedder.encode([question]), dtype='float32')
    distances, indices = index.search(q_embedding, k=top_k)

    results = []
    for i, idx in enumerate(indices[0]):
        chunk = chunks[idx]
        results.append({
            "text": chunk["text"],
            "file": chunk["file"],
            "function_name": chunk["function_name"],
            "start_line": chunk["start_line"],
            "end_line": chunk["end_line"],
            "distance": distances[0][i]
        })
    return results


def ask(question, index, chunks):
    """
    Full RAG pipeline: question → search → Gemini → answer with citations.
    """
    print(f"\nYou: {question}")

    # Step 1: Find relevant chunks
    relevant_chunks = search(question, index, chunks)

    # Step 2: Build context with citations
    context = ""
    for chunk in relevant_chunks:
        context += f"\n--- {chunk['file']} (lines {chunk['start_line']}-{chunk['end_line']}) ---\n"
        context += chunk["text"] + "\n"

    # Step 3: Send to Gemini
    prompt = f"""You are a code assistant helping a developer understand a codebase.
Use ONLY the code snippets below to answer the question.
Always mention which file and function your answer comes from.

Code context:
{context}

Question: {question}

Answer clearly and mention the exact file and function name."""

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt
    )

    print(f"\nGemini: {response.text}")

    # Step 4: Show citations
    print("\nSources:")
    for chunk in relevant_chunks:
        print(f"  → {chunk['file']} :: {chunk['function_name']}() line {chunk['start_line']}")
    print("-" * 50)


# Run it
if __name__ == "__main__":
    # Build the index from our sample repo
    index, chunks = build_index("sample_repo")

    # Ask questions
    ask("How does user authentication work?", index, chunks)
    ask("How are passwords hashed and stored?", index, chunks)
    ask("How do I connect to the database?", index, chunks)
    ask("How does email validation work?", index, chunks)