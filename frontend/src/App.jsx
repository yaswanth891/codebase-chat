import { useState, useRef, useEffect } from "react"
import axios from "axios"

const API = import.meta.env.VITE_API_URL || "https://codebase-chat-itiz.onrender.com"

export default function App() {
  // Authentication State
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem("chat_user");
    return saved ? JSON.parse(saved) : null;
  });
  const [token, setToken] = useState(() => {
    return localStorage.getItem("chat_token") || null;
  });
  
  // App State
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  
  // Input / Loading States
  const [githubUrl, setGithubUrl] = useState("");
  const [indexStatus, setIndexStatus] = useState(null);
  const [indexInfo, setIndexInfo] = useState(null);
  const [indexError, setIndexError] = useState("");
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  
  // Auth Form State
  const [demoEmail, setDemoEmail] = useState("");
  const [loginError, setLoginError] = useState("");

  const chatEndRef = useRef(null);

  // Auto-scroll chat history
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, asking]);

  // Request Headers Helper
  const getHeaders = () => {
    return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
  };

  // Google OAuth Initialization
  useEffect(() => {
    if (user) return;
    
    const initGoogle = () => {
      if (window.google) {
        window.google.accounts.id.initialize({
          client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID || "915830720496-d3v1e5vqvef4b4r8719h1f7a1q6lkn1e.apps.googleusercontent.com",
          callback: handleGoogleCredentialResponse,
        });
        window.google.accounts.id.renderButton(
          document.getElementById("google-signin-btn"),
          { theme: "outline", size: "large", width: "100%" }
        );
      } else {
        setTimeout(initGoogle, 300);
      }
    };
    
    initGoogle();
  }, [user]);

  // Handle Google Login Callback
  async function handleGoogleCredentialResponse(response) {
    const credential = response.credential;
    try {
      setLoginError("");
      const res = await axios.post(`${API}/auth/login`, { token: credential });
      const { user: loggedUser, token: authToken } = res.data;
      localStorage.setItem("chat_token", authToken);
      localStorage.setItem("chat_user", JSON.stringify(loggedUser));
      setToken(authToken);
      setUser(loggedUser);
    } catch (err) {
      setLoginError(err.response?.data?.detail || "Google authentication failed. Please try again.");
    }
  }

  // Handle Demo Login
  async function handleDemoLogin(e) {
    e.preventDefault();
    if (!demoEmail.trim() || !demoEmail.includes("@")) {
      setLoginError("Please enter a valid Gmail address.");
      return;
    }
    try {
      setLoginError("");
      const demoToken = `demo:${demoEmail.trim().toLowerCase()}`;
      const res = await axios.post(`${API}/auth/login`, { token: demoToken });
      const { user: loggedUser, token: authToken } = res.data;
      localStorage.setItem("chat_token", authToken);
      localStorage.setItem("chat_user", JSON.stringify(loggedUser));
      setToken(authToken);
      setUser(loggedUser);
    } catch (err) {
      setLoginError(err.response?.data?.detail || "Demo sign in failed. Please try again.");
    }
  }

  // Handle Sign Out
  function handleSignOut() {
    localStorage.removeItem("chat_token");
    localStorage.removeItem("chat_user");
    setUser(null);
    setToken(null);
    setSessions([]);
    setActiveSessionId(null);
    setMessages([]);
  }

  // Load user sessions
  useEffect(() => {
    if (user && token) {
      loadSessions();
    }
  }, [user, token]);

  async function loadSessions() {
    try {
      const res = await axios.get(`${API}/sessions`, getHeaders());
      setSessions(res.data);
      if (res.data.length > 0) {
        // Load the most recently updated session
        selectSession(res.data[0].id, res.data);
      }
    } catch (err) {
      console.error("Failed to load sessions:", err);
    }
  }

  // Select a chat session
  async function selectSession(sessionId, sessionsList = sessions) {
    setActiveSessionId(sessionId);
    setMessages([]);
    setIndexStatus(null);
    setIndexInfo(null);
    setIndexError("");

    const session = sessionsList.find(s => s.id === sessionId);
    if (session && session.repo_name) {
      setIndexInfo({
        repo: session.repo_name,
        total_chunks: "loaded",
        files_indexed: "loaded"
      });
      setIndexStatus("success");
    }

    try {
      const res = await axios.get(`${API}/sessions/${sessionId}/messages`, getHeaders());
      setMessages(res.data);
    } catch (err) {
      console.error("Failed to load session messages:", err);
    }
  }

  // Create a new chat session
  async function handleNewChat() {
    try {
      const res = await axios.post(`${API}/sessions`, {}, getHeaders());
      setSessions(prev => [res.data, ...prev]);
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
    if (!confirm("Are you sure you want to delete this chat session?")) return;
    
    try {
      await axios.delete(`${API}/sessions/${sessionId}`, getHeaders());
      const remaining = sessions.filter(s => s.id !== sessionId);
      setSessions(remaining);
      if (activeSessionId === sessionId) {
        if (remaining.length > 0) {
          selectSession(remaining[0].id, remaining);
        } else {
          setActiveSessionId(null);
          setMessages([]);
        }
      }
    } catch (err) {
      console.error("Failed to delete session:", err);
    }
  }

  // Index repository for active session
  async function handleIndex() {
    if (!githubUrl.trim() || !activeSessionId) return;
    setIndexStatus("loading");
    setIndexInfo(null);
    setIndexError("");
    try {
      const res = await axios.post(`${API}/sessions/${activeSessionId}/index`, {
        github_url: githubUrl
      }, getHeaders());
      
      // Update session info locally
      setSessions(prev => prev.map(s => {
        if (s.id === activeSessionId) {
          return { ...s, repo_url: githubUrl, repo_name: res.data.repo, title: `Chat on ${res.data.repo}` };
        }
        return s;
      }));
      
      setIndexInfo(res.data);
      setIndexStatus("success");
      setMessages([]);
    } catch (err) {
      setIndexError(err.response?.data?.detail || "Could not index. Make sure the repo is public and try again.");
      setIndexStatus("error");
    }
  }

  // Send a message
  async function handleAsk(text) {
    const q = text || question;
    if (!q.trim() || asking || !activeSessionId) return;
    
    const userMessage = { role: "user", text: q };
    setMessages(prev => [...prev, userMessage]);
    setQuestion("");
    setAsking(true);
    
    try {
      const res = await axios.post(`${API}/sessions/${activeSessionId}/query`, {
        question: q
      }, getHeaders());
      
      setMessages(prev => [...prev, {
        role: "bot",
        text: res.data.answer,
        sources: res.data.sources
      }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        role: "bot",
        text: err.response?.data?.detail || "Something went wrong. Please try again.",
        sources: []
      }]);
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

  // Format code blocks & inline code in responses
  function formatMessage(text) {
    if (!text) return "";
    
    const parts = text.split(/(```[\s\S]*?```)/g);
    return parts.map((part, index) => {
      if (part.startsWith("```") && part.endsWith("```")) {
        const code = part.slice(3, -3).trim();
        const lines = code.split("\n");
        let displayCode = code;
        let lang = "";
        
        if (lines.length > 1 && /^[a-zA-Z0-9_-]+$/.test(lines[0])) {
          lang = lines[0];
          displayCode = lines.slice(1).join("\n");
        }
        
        return (
          <pre key={index}>
            <code className={lang}>{displayCode}</code>
          </pre>
        );
      }
      
      const subParts = part.split(/(`[^`\n]+`)/g);
      return subParts.map((subPart, subIndex) => {
        if (subPart.startsWith("`") && subPart.endsWith("`")) {
          return <code key={`${index}-${subIndex}`}>{subPart.slice(1, -1)}</code>;
        }
        return subPart;
      });
    });
  }

  const suggestions = [
    "How does routing work?",
    "What is the request lifecycle?",
    "How are errors handled?",
  ];

  // Active Session info
  const activeSession = sessions.find(s => s.id === activeSessionId);

  // ── 1. LOGIN SCREEN ──
  if (!user) {
    return (
      <div className="login-container">
        <div className="login-card">
          <div className="login-logo">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
          </div>
          <h1 className="login-title">Codebase Chat</h1>
          <p className="login-subtitle">Authenticate to start chatting with your repositories and save your history.</p>
          
          {loginError && (
            <div className="status-indicator error" style={{ width: "100%", marginTop: 0, marginBottom: "20px" }}>
              <span>{loginError}</span>
            </div>
          )}

          {/* Google Login Button */}
          <div className="google-btn-wrapper">
            <div id="google-signin-btn" style={{ width: "100%" }}></div>
          </div>

          <div className="login-divider">or</div>

          {/* Fallback Gmail Demo Login */}
          <form className="demo-login-form" onSubmit={handleDemoLogin}>
            <div className="demo-login-label">Gmail Address</div>
            <div className="input-container">
              <span className="input-icon">@</span>
              <input
                className="custom-input"
                type="email"
                placeholder="you@gmail.com"
                value={demoEmail}
                onChange={e => setDemoEmail(e.target.value)}
                required
              />
            </div>
            <button className="btn-primary" type="submit" style={{ width: "100%" }}>
              Launch Demo Chat
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── 2. APPLICATION DASHBOARD (Logged In) ──
  return (
    <div className="app-layout">
      {/* LEFT SIDEBAR */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="logo-icon" style={{ width: "28px", height: "28px" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
          </div>
          <span className="logo-name" style={{ fontSize: "16px" }}>Codebase Chat</span>
        </div>

        <button className="sidebar-new-chat-btn" onClick={handleNewChat}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Chat
        </button>

        <div className="sidebar-sessions">
          <div className="card-label" style={{ paddingLeft: "4px" }}>Recent Chats</div>
          {sessions.length === 0 ? (
            <div style={{ padding: "10px 4px", fontSize: "13px", color: "var(--text-muted)", fontStyle: "italic" }}>
              No chats yet.
            </div>
          ) : (
            sessions.map(s => (
              <div
                key={s.id}
                className={`sidebar-session-item ${s.id === activeSessionId ? "active" : ""}`}
                onClick={() => selectSession(s.id)}
              >
                <span className="sidebar-session-title">
                  {s.title}
                </span>
                <button
                  className="sidebar-session-delete"
                  onClick={(e) => handleDeleteSession(s.id, e)}
                  title="Delete Session"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    <line x1="10" y1="11" x2="10" y2="17" />
                    <line x1="14" y1="11" x2="14" y2="17" />
                  </svg>
                </button>
              </div>
            ))
          )}
        </div>

        <div className="sidebar-footer">
          <div className="user-profile-info">
            {user.picture ? (
              <img className="user-avatar" src={user.picture} alt={user.name} />
            ) : (
              <div className="user-avatar">
                {user.name ? user.name.charAt(0).toUpperCase() : user.email.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="user-details">
              <span className="user-name">{user.name || "User"}</span>
              <span className="user-email">{user.email}</span>
            </div>
          </div>
          <button className="logout-btn" onClick={handleSignOut} title="Log Out">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <main className="main-content">
        {activeSession ? (
          <>
            {/* Header info */}
            {activeSession.repo_url && (
              <div className="main-content-header">
                <div className="active-repo-badge">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
                  </svg>
                  <a href={activeSession.repo_url} target="_blank" rel="noreferrer">
                    {activeSession.repo_name}
                  </a>
                </div>
                
                {indexStatus === "success" && (
                  <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                    Repository Indexed
                  </div>
                )}
              </div>
            )}

            {/* Chat or Index setup */}
            <div className="chat-container-layout">
              {!activeSession.repo_url ? (
                /* REPOSITORY SETUP (New Session, no repo url) */
                <div style={{ width: "100%", margin: "auto 0" }}>
                  <div className="hero">
                    <h1>Understand any codebase, instantly</h1>
                    <p>Paste a public GitHub repository URL, ask questions in plain English, and get precise answers with source citations.</p>
                  </div>

                  <div className="glass-card">
                    <div className="card-label">Repository Setup</div>
                    <div className="flex-row">
                      <div className="input-container">
                        <span className="input-icon">#</span>
                        <input
                          className="custom-input"
                          type="text"
                          placeholder="https://github.com/owner/repo"
                          value={githubUrl}
                          onChange={e => setGithubUrl(e.target.value)}
                          disabled={indexStatus === "loading"}
                        />
                      </div>
                      <button
                        className="btn-primary"
                        onClick={handleIndex}
                        disabled={indexStatus === "loading" || !githubUrl.trim()}
                      >
                        {indexStatus === "loading" ? "Indexing..." : "Index Repo"}
                      </button>
                    </div>

                    {indexStatus === "loading" && (
                      <div className="status-indicator loading">
                        <div className="spinner"></div>
                        <span>Cloning and indexing repository — this usually takes 1–2 minutes...</span>
                      </div>
                    )}
                    
                    {indexStatus === "error" && (
                      <div className="status-indicator error">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="12" y1="8" x2="12" y2="12" />
                          <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                        <span>{indexError}</span>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* CHAT WINDOW INTERFACE */
                <div className="chat-window">
                  <div className="chat-history">
                    {messages.length === 0 && (
                      <div className="empty-chat">
                        <p className="empty-chat-title">Ask a question about the repository structures or logic</p>
                        <div className="suggestions-grid">
                          {suggestions.map((q, i) => (
                            <button key={i} className="suggestion-btn" onClick={() => handleAsk(q)}>
                              {q}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {messages.map((msg, i) => (
                      <div key={i} className={`message-row ${msg.role}`}>
                        <div className="bubble">
                          {msg.role === "bot" ? formatMessage(msg.text) : msg.text}
                        </div>
                        {msg.sources && msg.sources.length > 0 && (
                          <div className="citations-list">
                            {msg.sources.map((src, j) => (
                              <span key={j} className="citation-tag" title={src.file}>
                                <span className="citation-icon"></span>
                                {src.file.split("/").pop()} · {src.function_name}() line {src.start_line}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                    
                    {asking && (
                      <div className="message-row bot">
                        <div className="bubble">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div className="spinner"></div>
                            <span>Analyzing codebase context...</span>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    <div ref={chatEndRef} />
                  </div>

                  <div className="chat-divider" />

                  {/* Chat Input Field */}
                  <div className="flex-row">
                    <div className="input-container">
                      <span className="input-icon">›</span>
                      <input
                        className="custom-input"
                        type="text"
                        placeholder="Ask anything about the codebase..."
                        value={question}
                        onChange={e => setQuestion(e.target.value)}
                        onKeyDown={handleKeyDown}
                        disabled={asking}
                      />
                    </div>
                    <button
                      className="btn-primary"
                      onClick={() => handleAsk()}
                      disabled={asking || !question.trim()}
                    >
                      Ask
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          /* NO ACTIVE CHAT WELCOME SCREEN */
          <div style={{ margin: "auto", padding: "40px", textAlign: "center", maxWidth: "500px" }}>
            <div className="login-logo" style={{ margin: "0 auto 24px" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="4 17 10 11 4 5" />
                <line x1="12" y1="19" x2="20" y2="19" />
              </svg>
            </div>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "24px", fontWeight: 700, marginBottom: "12px" }}>
              Welcome back, {user.name || "Developer"}!
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "15px", lineHeight: 1.6, marginBottom: "24px" }}>
              Select an existing chat from the sidebar, or create a new chat to begin exploring a codebase.
            </p>
            <button className="btn-primary" onClick={handleNewChat} style={{ margin: "0 auto" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Start New Chat
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
