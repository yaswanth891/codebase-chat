import sqlite3
import os
import json
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "chat.db")

def get_db():
    # Ensure the directory exists
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()
    
    # Create users table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        name TEXT,
        picture TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)
    
    # Create sessions table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        repo_url TEXT,
        repo_name TEXT,
        title TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
    """)
    
    # Create messages table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        sources TEXT,  -- JSON serialized list of source chunks
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE
    )
    """)
    
    conn.commit()
    conn.close()

def get_or_create_user(email: str, name: str = None, picture: str = None):
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT * FROM users WHERE email = ?", (email,))
        user = cursor.fetchone()
        if user:
            # Update name/picture if they changed or were missing
            if (name and user["name"] != name) or (picture and user["picture"] != picture):
                cursor.execute(
                    "UPDATE users SET name = ?, picture = ? WHERE email = ?",
                    (name or user["name"], picture or user["picture"], email)
                )
                conn.commit()
                cursor.execute("SELECT * FROM users WHERE email = ?", (email,))
                user = cursor.fetchone()
            return dict(user)
        
        # Create user
        cursor.execute(
            "INSERT INTO users (email, name, picture) VALUES (?, ?, ?)",
            (email, name, picture)
        )
        conn.commit()
        
        cursor.execute("SELECT * FROM users WHERE email = ?", (email,))
        return dict(cursor.fetchone())
    finally:
        conn.close()

def create_session(session_id: str, user_id: int, repo_url: str = None, repo_name: str = None, title: str = "New Chat"):
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "INSERT INTO sessions (id, user_id, repo_url, repo_name, title) VALUES (?, ?, ?, ?, ?)",
            (session_id, user_id, repo_url, repo_name, title)
        )
        conn.commit()
        cursor.execute("SELECT * FROM sessions WHERE id = ?", (session_id,))
        return dict(cursor.fetchone())
    finally:
        conn.close()

def get_user_sessions(user_id: int):
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT * FROM sessions WHERE user_id = ? ORDER BY updated_at DESC",
            (user_id,)
        )
        return [dict(row) for row in cursor.fetchall()]
    finally:
        conn.close()

def get_session(session_id: str):
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT * FROM sessions WHERE id = ?", (session_id,))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()

def delete_session(session_id: str):
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        conn.commit()
        return True
    finally:
        conn.close()

def update_session_repo(session_id: str, repo_url: str, repo_name: str, title: str = None):
    conn = get_db()
    cursor = conn.cursor()
    try:
        if title:
            cursor.execute(
                "UPDATE sessions SET repo_url = ?, repo_name = ?, title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (repo_url, repo_name, title, session_id)
            )
        else:
            cursor.execute(
                "UPDATE sessions SET repo_url = ?, repo_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (repo_url, repo_name, session_id)
            )
        conn.commit()
        cursor.execute("SELECT * FROM sessions WHERE id = ?", (session_id,))
        return dict(cursor.fetchone())
    finally:
        conn.close()

def add_message(session_id: str, role: str, text: str, sources: list = None):
    conn = get_db()
    cursor = conn.cursor()
    try:
        sources_str = json.dumps(sources) if sources else None
        cursor.execute(
            "INSERT INTO messages (session_id, role, text, sources) VALUES (?, ?, ?, ?)",
            (session_id, role, text, sources_str)
        )
        # Also update session's updated_at
        cursor.execute(
            "UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (session_id,)
        )
        conn.commit()
        return cursor.lastrowid
    finally:
        conn.close()

def get_session_messages(session_id: str):
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT role, text, sources, created_at FROM messages WHERE session_id = ? ORDER BY created_at ASC",
            (session_id,)
        )
        messages = []
        for row in cursor.fetchall():
            msg = dict(row)
            msg["sources"] = json.loads(msg["sources"]) if msg["sources"] else []
            messages.append(msg)
        return messages
    finally:
        conn.close()
