import { useState, useRef, useEffect } from "react";
import axios from "axios";

const API =
  import.meta.env.VITE_API_URL ||
  (typeof window !== "undefined" &&
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
    ? "http://localhost:8000"
    : "https://codebase-chat-itiz.onrender.com");

// ── Markdown Formatter Component (No Asterisk Artifacts) ──────────────────────────
function FormattedInline({ text }) {
  if (!text) return null;

  // Clean any triple/double asterisks or rogue chars first
  // Tokenize by inline code, bold, italic
  const parts = [];
  let remaining = text;

  // Regex matches: `inline code`, **bold**, *italic*
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|(?<!\*)\*[^*]+\*(?!\*))/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({
        type: "text",
        content: text.substring(lastIndex, match.index),
      });
    }

    const matchedStr = match[0];
    if (matchedStr.startsWith("`") && matchedStr.endsWith("`")) {
      parts.push({
        type: "code",
        content: matchedStr.slice(1, -1),
      });
    } else if (
      (matchedStr.startsWith("**") && matchedStr.endsWith("**")) ||
      (matchedStr.startsWith("__") && matchedStr.endsWith("__"))
    ) {
      parts.push({
        type: "bold",
        content: matchedStr.slice(2, -2),
      });
    } else if (matchedStr.startsWith("*") && matchedStr.endsWith("*")) {
      parts.push({
        type: "italic",
        content: matchedStr.slice(1, -1),
      });
    }
    lastIndex = match.index + matchedStr.length;
  }

  if (lastIndex < text.length) {
    parts.push({
      type: "text",
      content: text.substring(lastIndex),
    });
  }

  return (
    <>
      {parts.map((part, idx) => {
        if (part.type === "code") {
          return (
            <code key={idx} className="inline-code">
              {part.content}
            </code>
          );
        }
        if (part.type === "bold") {
          return (
            <strong key={idx} className="font-semibold text-white">
              {part.content}
            </strong>
          );
        }
        if (part.type === "italic") {
          return (
            <em key={idx} className="italic text-slate-300">
              {part.content}
            </em>
          );
        }
        // Clean stray edge asterisks from unclosed markdown tokens while preserving *args/**kwargs
        const cleaned = part.content.replace(/(^\*{1,2}(?!\w)|(?<!\w)\*{1,2}$)/g, "");
        return <span key={idx}>{cleaned}</span>;
      })}
    </>
  );
}

function CodeBlock({ code, lang }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="code-block-wrapper">
      <div className="code-block-header">
        <span className="code-block-lang">{lang || "code"}</span>
        <button
          className="code-copy-btn"
          onClick={handleCopy}
          type="button"
          title="Copy code"
        >
          {copied ? (
            <>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>Copied</span>
            </>
          ) : (
            <>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="code-pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function FormattedMessage({ text }) {
  if (!text) return "";

  // Split by markdown fenced code blocks ```lang ... ```
  const rawBlocks = text.split(/(```[\s\S]*?```)/g);

  return (
    <div className="formatted-message-body">
      {rawBlocks.map((block, blockIndex) => {
        if (block.startsWith("```") && block.endsWith("```")) {
          const content = block.slice(3, -3).trim();
          const firstLineBreak = content.indexOf("\n");
          let lang = "";
          let code = content;

          if (firstLineBreak > 0) {
            const possibleLang = content.slice(0, firstLineBreak).trim();
            if (/^[a-zA-Z0-9_#-]+$/.test(possibleLang)) {
              lang = possibleLang;
              code = content.slice(firstLineBreak + 1);
            }
          }
          return <CodeBlock key={blockIndex} code={code} lang={lang} />;
        }

        // Process prose block lines
        const lines = block.split("\n");
        const renderedElements = [];
        let currentList = [];
        let listType = null; // 'ul' or 'ol'

        const flushList = (keyPrefix) => {
          if (currentList.length > 0) {
            if (listType === "ol") {
              renderedElements.push(
                <ol key={`${keyPrefix}-ol`} className="message-ol">
                  {currentList.map((item, liIdx) => (
                    <li key={liIdx}>
                      <FormattedInline text={item} />
                    </li>
                  ))}
                </ol>
              );
            } else {
              renderedElements.push(
                <ul key={`${keyPrefix}-ul`} className="message-ul">
                  {currentList.map((item, liIdx) => (
                    <li key={liIdx}>
                      <FormattedInline text={item} />
                    </li>
                  ))}
                </ul>
              );
            }
            currentList = [];
            listType = null;
          }
        };

        lines.forEach((line, lineIdx) => {
          const trimmed = line.trim();
          if (!trimmed) {
            flushList(`empty-${lineIdx}`);
            return;
          }

          // Heading checks: ### Heading, ## Heading, # Heading
          if (trimmed.startsWith("### ")) {
            flushList(`h3-${lineIdx}`);
            renderedElements.push(
              <h3 key={`h3-${lineIdx}`} className="message-h3">
                <FormattedInline text={trimmed.slice(4)} />
              </h3>
            );
            return;
          }
          if (trimmed.startsWith("## ")) {
            flushList(`h2-${lineIdx}`);
            renderedElements.push(
              <h2 key={`h2-${lineIdx}`} className="message-h2">
                <FormattedInline text={trimmed.slice(3)} />
              </h2>
            );
            return;
          }
          if (trimmed.startsWith("# ")) {
            flushList(`h1-${lineIdx}`);
            renderedElements.push(
              <h1 key={`h1-${lineIdx}`} className="message-h1">
                <FormattedInline text={trimmed.slice(2)} />
              </h1>
            );
            return;
          }

          // Blockquote check: > quote
          if (trimmed.startsWith("> ")) {
            flushList(`quote-${lineIdx}`);
            renderedElements.push(
              <blockquote key={`quote-${lineIdx}`} className="message-blockquote">
                <FormattedInline text={trimmed.slice(2)} />
              </blockquote>
            );
            return;
          }

          // Unordered list item check: * item or - item or + item
          const ulMatch = trimmed.match(/^[-*+]\s+(.+)/);
          if (ulMatch) {
            if (listType && listType !== "ul") {
              flushList(`switch-ul-${lineIdx}`);
            }
            listType = "ul";
            currentList.push(ulMatch[1]);
            return;
          }

          // Ordered list item check: 1. item
          const olMatch = trimmed.match(/^\d+\.\s+(.+)/);
          if (olMatch) {
            if (listType && listType !== "ol") {
              flushList(`switch-ol-${lineIdx}`);
            }
            listType = "ol";
            currentList.push(olMatch[1]);
            return;
          }

          // Regular paragraph line
          flushList(`flush-${lineIdx}`);
          renderedElements.push(
            <p key={`p-${lineIdx}`} className="message-p">
              <FormattedInline text={trimmed} />
            </p>
          );
        });

        flushList(`final-${blockIndex}`);

        return <div key={blockIndex}>{renderedElements}</div>;
      })}
    </div>
  );
}

// ── Main App Component ─────────────────────────────────────────────────────────────
export default function App() {
  // App Sessions & Navigation
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [messages, setMessages] = useState([]);

  // Repository Indexing State
  const [githubUrl, setGithubUrl] = useState("");
  const [indexStatus, setIndexStatus] = useState(null); // 'loading' | 'success' | 'error'
  const [indexInfo, setIndexInfo] = useState(null);
  const [indexError, setIndexError] = useState("");

  // Chat Query State
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [copiedMsgIdx, setCopiedMsgIdx] = useState(null);

  const chatEndRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll chat history
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, asking]);

  // Initial Load: Fetch Sessions
  useEffect(() => {
    loadSessions();
  }, []);

  // Global Keyboard Shortcut: Cmd/Ctrl + N for new session
  useEffect(() => {
    function handleGlobalKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        handleNewChat();
      }
    }
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  async function loadSessions() {
    try {
      const res = await axios.get(`${API}/sessions`);
      setSessions(res.data);
      if (res.data.length > 0) {
        selectSession(res.data[0].id, res.data);
      } else {
        // Auto-create initial session if none exists
        handleNewChat();
      }
    } catch (err) {
      console.error("Failed to load sessions:", err);
      // Fallback: create fresh session
      handleNewChat();
    }
  }

  // Select a chat session
  async function selectSession(sessionId, sessionsList = sessions) {
    setActiveSessionId(sessionId);
    setMessages([]);
    setIndexStatus(null);
    setIndexInfo(null);
    setIndexError("");

    const session = sessionsList.find((s) => s.id === sessionId);
    setGithubUrl(session?.repo_url || "");
    if (session && session.repo_name) {
      setIndexInfo({
        repo: session.repo_name,
        total_chunks: "loaded",
        files_indexed: "loaded",
      });
      setIndexStatus("success");
    }

    try {
      const res = await axios.get(`${API}/sessions/${sessionId}/messages`);
      setMessages(res.data);
    } catch (err) {
      console.error("Failed to load session messages:", err);
    }
  }

  // Create a new chat session
  async function handleNewChat() {
    try {
      const res = await axios.post(`${API}/sessions`, {});
      setSessions((prev) => [res.data, ...prev.filter((s) => s.id !== res.data.id)]);
      setActiveSessionId(res.data.id);
      setMessages([]);
      setGithubUrl("");
      setIndexStatus(null);
      setIndexInfo(null);
      setIndexError("");
    } catch (err) {
      console.error("Failed to create new session:", err);
    }
  }

  // Delete a chat session
  async function handleDeleteSession(sessionId, e) {
    e.stopPropagation();
    try {
      await axios.delete(`${API}/sessions/${sessionId}`);
      const remaining = sessions.filter((s) => s.id !== sessionId);
      setSessions(remaining);
      if (activeSessionId === sessionId) {
        if (remaining.length > 0) {
          selectSession(remaining[0].id, remaining);
        } else {
          handleNewChat();
        }
      }
    } catch (err) {
      console.error("Failed to delete session:", err);
    }
  }

  // Index repository for active session
  async function handleIndex(targetUrl) {
    const urlToIndex = targetUrl || githubUrl;
    if (!urlToIndex.trim() || !activeSessionId) return;

    setGithubUrl(urlToIndex);
    setIndexStatus("loading");
    setIndexInfo(null);
    setIndexError("");

    try {
      const res = await axios.post(`${API}/sessions/${activeSessionId}/index`, {
        github_url: urlToIndex.trim(),
      });

      // Update session info locally
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id === activeSessionId) {
            return {
              ...s,
              repo_url: urlToIndex.trim(),
              repo_name: res.data.repo,
              title: `Chat on ${res.data.repo}`,
            };
          }
          return s;
        })
      );

      setIndexInfo(res.data);
      setIndexStatus("success");
      setMessages([]);
      setTimeout(() => inputRef.current?.focus(), 150);
    } catch (err) {
      setIndexError(
        err.response?.data?.detail ||
          "Could not index repository. Please make sure the repo is public and contains Python code."
      );
      setIndexStatus("error");
    }
  }

  // Send a question
  async function handleAsk(text) {
    const q = text || question;
    if (!q.trim() || asking || !activeSessionId) return;

    const userMessage = { role: "user", text: q };
    setMessages((prev) => [...prev, userMessage]);
    setQuestion("");
    setAsking(true);

    try {
      const res = await axios.post(`${API}/sessions/${activeSessionId}/query`, {
        question: q,
      });

      setMessages((prev) => [
        ...prev,
        {
          role: "bot",
          text: res.data.answer,
          sources: res.data.sources,
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "bot",
          text: err.response?.data?.detail || "Something went wrong while querying the codebase.",
          sources: [],
        },
      ]);
    } finally {
      setAsking(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAsk();
    }
  }

  const copyFullMessage = (text, idx) => {
    navigator.clipboard.writeText(text);
    setCopiedMsgIdx(idx);
    setTimeout(() => setCopiedMsgIdx(null), 2000);
  };

  const sampleRepos = [
    { name: "pallets/flask", desc: "Python WSGI microframework", url: "https://github.com/pallets/flask" },
    { name: "fastapi/fastapi", desc: "High-performance Python web framework", url: "https://github.com/fastapi/fastapi" },
    { name: "psf/requests", desc: "HTTP for Humans", url: "https://github.com/psf/requests" },
  ];

  const suggestedQuestions = [
    "Give an architectural overview of this repository",
    "Where is authentication and request validation handled?",
    "List the main API endpoints and their function handlers",
    "How does error handling and database access work?",
  ];

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  return (
    <div className="app-layout">
      {/* ── SIDEBAR ── */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-logo-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
          </div>
          <div className="brand-text">
            <span className="brand-title">Codebase Chat</span>
            <span className="brand-badge">PRO</span>
          </div>
        </div>

        <button className="new-chat-btn" onClick={handleNewChat}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>New Session</span>
          <kbd className="kbd-shortcut">⌘N</kbd>
        </button>

        <div className="sidebar-section-title">CHATS & SESSIONS</div>

        <div className="sidebar-sessions-list">
          {sessions.length === 0 ? (
            <div className="empty-sessions-notice">No sessions yet</div>
          ) : (
            sessions.map((s) => (
              <div
                key={s.id}
                className={`session-nav-item ${s.id === activeSessionId ? "active" : ""}`}
                onClick={() => selectSession(s.id)}
              >
                <div className="session-item-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <div className="session-item-content">
                  <span className="session-item-title">{s.title || "New Chat"}</span>
                  {s.repo_name && <span className="session-item-repo">{s.repo_name}</span>}
                </div>
                <button
                  className="session-delete-btn"
                  onClick={(e) => handleDeleteSession(s.id, e)}
                  title="Delete session"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))
          )}
        </div>

        {/* Sidebar Footer */}
        <div className="sidebar-footer">
          <div className="workspace-status">
            <div className="status-dot"></div>
            <div className="status-meta">
              <span className="status-label">Workspace Active</span>
              <span className="status-sub">RAG Engine Ready</span>
            </div>
          </div>
        </div>
      </aside>

      {/* ── MAIN CONTENT ── */}
      <main className="main-viewport">
        {/* TOP BAR */}
        <header className="viewport-header">
          <div className="header-left">
            {activeSession?.repo_name ? (
              <div className="repo-pill-badge">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
                </svg>
                <a
                  href={activeSession.repo_url}
                  target="_blank"
                  rel="noreferrer"
                  className="repo-pill-link"
                >
                  {activeSession.repo_name}
                </a>
                <span className="repo-status-chip">Indexed</span>
              </div>
            ) : (
              <div className="header-session-title">
                <span>Codebase Explorer</span>
              </div>
            )}
          </div>

          <div className="header-right">
            {activeSession?.repo_url && (
              <button
                className="header-action-btn"
                onClick={() => {
                  setSessions((prev) =>
                    prev.map((s) =>
                      s.id === activeSessionId ? { ...s, repo_url: null, repo_name: null } : s
                    )
                  );
                  setMessages([]);
                  setIndexStatus(null);
                }}
                title="Connect a different repository"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Switch Repo</span>
              </button>
            )}
          </div>
        </header>

        {/* VIEWPORT BODY */}
        <div className="viewport-body">
          {!activeSession?.repo_url ? (
            /* ── REPO SETUP VIEW ── */
            <div className="setup-container">
              <div className="setup-hero">
                <div className="hero-badge">
                  <span className="pulse-dot"></span>
                  AST Function Chunking & Vector Search
                </div>
                <h1 className="hero-title">
                  Understand any codebase, <span className="gradient-text">instantly</span>.
                </h1>
                <p className="hero-desc">
                  Index any public GitHub repository to extract functions, build high-dimensional embeddings, and query logic with precise file and line citations.
                </p>
              </div>

              <div className="setup-card">
                <div className="setup-input-row">
                  <div className="setup-input-wrap">
                    <span className="setup-input-icon">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="2" y1="12" x2="22" y2="12" />
                        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                      </svg>
                    </span>
                    <input
                      className="setup-input"
                      type="text"
                      placeholder="https://github.com/username/repository"
                      value={githubUrl}
                      onChange={(e) => setGithubUrl(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleIndex()}
                      disabled={indexStatus === "loading"}
                      autoFocus
                    />
                  </div>
                  <button
                    className="setup-submit-btn"
                    onClick={() => handleIndex()}
                    disabled={indexStatus === "loading" || !githubUrl.trim()}
                  >
                    {indexStatus === "loading" ? (
                      <>
                        <div className="btn-spinner"></div>
                        <span>Indexing...</span>
                      </>
                    ) : (
                      <>
                        <span>Index Repository</span>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </>
                    )}
                  </button>
                </div>

                {/* Loading Status with Step Progress */}
                {indexStatus === "loading" && (
                  <div className="indexing-status-box">
                    <div className="indexing-header">
                      <div className="btn-spinner"></div>
                      <span>Cloning and indexing repository AST...</span>
                    </div>
                    <div className="indexing-steps">
                      <div className="indexing-step active">
                        <span className="step-check">✓</span> 1. Cloning git tree
                      </div>
                      <div className="indexing-step active">
                        <span className="step-check">✓</span> 2. Extracting Python AST functions
                      </div>
                      <div className="indexing-step in-progress">
                        <span className="step-pulse"></span> 3. Generating Gemini vector embeddings
                      </div>
                    </div>
                  </div>
                )}

                {/* Error Banner */}
                {indexStatus === "error" && (
                  <div className="setup-error-banner">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <span>{indexError}</span>
                  </div>
                )}

                {/* Quick Start Repositories */}
                <div className="quick-repos-section">
                  <div className="quick-repos-label">Quick-start with popular repositories:</div>
                  <div className="quick-repos-grid">
                    {sampleRepos.map((repo, idx) => (
                      <button
                        key={idx}
                        className="quick-repo-card"
                        onClick={() => handleIndex(repo.url)}
                        disabled={indexStatus === "loading"}
                      >
                        <div className="quick-repo-name">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
                          </svg>
                          <span>{repo.name}</span>
                        </div>
                        <div className="quick-repo-desc">{repo.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* ── CHAT SESSION VIEW ── */
            <div className="chat-interface">
              <div className="messages-scroll-area">
                {messages.length === 0 && (
                  <div className="chat-empty-state">
                    <div className="empty-state-icon">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </svg>
                    </div>
                    <h3 className="empty-state-title">Ready to analyze {activeSession.repo_name}</h3>
                    <p className="empty-state-sub">
                      Ask any question regarding functions, routes, data flow, or architecture.
                    </p>

                    <div className="suggestions-list">
                      {suggestedQuestions.map((q, idx) => (
                        <button
                          key={idx}
                          className="suggestion-chip"
                          onClick={() => handleAsk(q)}
                        >
                          <span className="suggestion-arrow">›</span>
                          <span>{q}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((msg, i) => (
                  <div key={i} className={`chat-message-row ${msg.role}`}>
                    <div className="message-avatar">
                      {msg.role === "user" ? (
                        <span className="user-avatar-badge">YOU</span>
                      ) : (
                        <div className="bot-avatar-badge">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <polyline points="16 18 22 12 16 6" />
                            <polyline points="8 6 2 12 8 18" />
                          </svg>
                        </div>
                      )}
                    </div>

                    <div className="message-content-box">
                      <div className="message-header-bar">
                        <span className="message-sender-name">
                          {msg.role === "user" ? "You" : "Codebase AI"}
                        </span>
                        {msg.role === "bot" && (
                          <button
                            className="message-action-btn"
                            onClick={() => copyFullMessage(msg.text, i)}
                            title="Copy response"
                          >
                            {copiedMsgIdx === i ? (
                              <>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                                <span>Copied</span>
                              </>
                            ) : (
                              <>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                </svg>
                                <span>Copy</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>

                      <div className="message-bubble">
                        {msg.role === "bot" ? (
                          <FormattedMessage text={msg.text} />
                        ) : (
                          <p className="user-query-text">{msg.text}</p>
                        )}
                      </div>

                      {msg.sources && msg.sources.length > 0 && (
                        <div className="sources-container">
                          <div className="sources-header">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                              <polyline points="14 2 14 8 20 8" />
                            </svg>
                            <span>Referenced Source Chunks ({msg.sources.length})</span>
                          </div>
                          <div className="sources-grid">
                            {msg.sources.map((src, j) => {
                              const cleanFileName = src.file.split(/[/\\]/).pop();
                              const cleanRepoUrl = activeSession?.repo_url?.replace(/\.git$/, "").replace(/\/$/, "");
                              const githubFileLineUrl = cleanRepoUrl
                                ? `${cleanRepoUrl}/blob/main/${src.file.replace(/\\/g, "/")}#L${src.start_line}`
                                : null;

                              const cardContent = (
                                <>
                                  <div className="source-file-row">
                                    <span className="source-icon">📄</span>
                                    <span className="source-file-name" title={src.file}>
                                      {cleanFileName}
                                    </span>
                                    <span className="source-line-tag">
                                      line {src.start_line}
                                    </span>
                                    {githubFileLineUrl && (
                                      <svg className="source-external-icon" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                        <polyline points="15 3 21 3 21 9" />
                                        <line x1="10" y1="14" x2="21" y2="3" />
                                      </svg>
                                    )}
                                  </div>
                                  <div className="source-func-name">
                                    <code>{src.function_name}()</code>
                                  </div>
                                </>
                              );

                              return githubFileLineUrl ? (
                                <a
                                  key={j}
                                  href={githubFileLineUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="source-card source-card-link"
                                  title={`Open ${src.file} line ${src.start_line} on GitHub`}
                                >
                                  {cardContent}
                                </a>
                              ) : (
                                <div key={j} className="source-card" title={src.file}>
                                  {cardContent}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {asking && (
                  <div className="chat-message-row bot">
                    <div className="message-avatar">
                      <div className="bot-avatar-badge">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <polyline points="16 18 22 12 16 6" />
                          <polyline points="8 6 2 12 8 18" />
                        </svg>
                      </div>
                    </div>
                    <div className="message-content-box">
                      <div className="message-bubble thinking-bubble">
                        <div className="thinking-loader">
                          <span className="loader-dot"></span>
                          <span className="loader-dot"></span>
                          <span className="loader-dot"></span>
                        </div>
                        <span className="thinking-label">Querying vector index & synthesizing answer...</span>
                      </div>
                    </div>
                  </div>
                )}

                <div ref={chatEndRef} />
              </div>

              {/* Chat Input Bar */}
              <div className="chat-input-container">
                <div className="chat-input-bar">
                  <div className="input-prompt-icon">›</div>
                  <input
                    ref={inputRef}
                    className="chat-text-input"
                    type="text"
                    placeholder="Ask anything about this codebase (e.g. explain auth flow, list endpoints)..."
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={asking}
                  />
                  <button
                    className="chat-send-btn"
                    onClick={() => handleAsk()}
                    disabled={asking || !question.trim()}
                    type="button"
                  >
                    <span>Send</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="22" y1="2" x2="11" y2="13" />
                      <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                  </button>
                </div>
                <div className="chat-input-footer">
                  <span>Press <kbd>Enter</kbd> to submit query · Grounded in AST code chunks</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
