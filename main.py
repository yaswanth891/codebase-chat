import faiss
import numpy as np
from sentence_transformers import SentenceTransformer
from dotenv import load_dotenv
import os
from google import genai

# Setup
load_dotenv()
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
print("Loading embedding model...")
embedder = SentenceTransformer("all-MiniLM-L6-v2")
print("Ready!\n")

# Imagine these are chunks of code from a real repo
code_chunks = [
    "def authenticate_user(username, password): checks credentials against database and returns user object if valid",
    "def connect_to_database(host, port): establishes a connection to PostgreSQL database using psycopg2",
    "def hash_password(password): uses bcrypt to hash the password securely before storing in database",
    "def send_email(to, subject, body): sends email using SMTP server with TLS encryption",
    "def calculate_tax(amount, rate): multiplies amount by tax rate and returns the result",
    "def generate_jwt_token(user_id): creates a signed JWT token with expiry for authentication",
    "def parse_csv_file(filepath): reads CSV file and returns list of row dictionaries",
    "def validate_email(email): checks if email format is valid using regex pattern",
]

# Step 1: Embed and store all chunks in FAISS
embeddings = model = embedder.encode(code_chunks)
embeddings = np.array(embeddings, dtype='float32')
dimension = embeddings.shape[1]
index = faiss.IndexFlatL2(dimension)
index.add(embeddings)

def ask(question):
    print(f"\nYou: {question}")
    
    # Step 2: Embed the question and search FAISS
    q_embedding = np.array(embedder.encode([question]), dtype='float32')
    distances, indices = index.search(q_embedding, k=3)
    
    # Step 3: Build context from retrieved chunks
    context = "\n".join([code_chunks[i] for i in indices[0]])
    
    # Step 4: Send to Gemini with the context
    prompt = f"""You are a code assistant. Use the following code snippets to answer the question.
    
Code context:
{context}

Question: {question}

Give a clear, concise answer based only on the code context above."""

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt
    )
    
    print(f"\nGemini: {response.text}")
    print("-" * 50)

# Test it
ask("How does authentication work in this codebase?")
ask("How are passwords stored?")
ask("What does the tax calculation do?")