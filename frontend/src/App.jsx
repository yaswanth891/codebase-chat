import { useState, useRef, useEffect } from "react"
import axios from "axios"

const API = import.meta.env.VITE_API_URL || "https://codebase-chat-itiz.onrender.com"

export default function App() {
  const [githubUrl, setGithubUrl] = useState("")
  const [indexStatus, setIndexStatus] = useState(null)
  const [indexInfo, setIndexInfo] = useState(null)
  const [indexError, setIndexError] = useState("")
  const [question, setQuestion] = useState("")
  const [messages, setMessages] = useState([])
  const [asking, setAsking] = useState(false)

  const chatEndRef = useRef(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, asking])

  async function handleIndex() {
    if (!githubUrl.trim()) return
    setIndexStatus("loading")
    setIndexInfo(null)
    setIndexError("")
    try {
      const res = await axios.post(`${API}/index-github`, {
        github_url: githubUrl
      })
      setIndexInfo(res.data)
      setIndexStatus("success")
      setMessages([])
    } catch (err) {
      setIndexError(err.response?.data?.detail || "Could not index. Make sure the repo is public and try again.")
      setIndexStatus("error")
    }
  }

  async function handleAsk(text) {
    const q = text || question
    if (!q.trim() || asking) return
    const userMessage = { role: "user", text: q }
    setMessages(prev => [...prev, userMessage])
    setQuestion("")
    setAsking(true)
    try {
      const res = await axios.post(`${API}/query`, {
        question: q
      })
      setMessages(prev => [...prev, {
        role: "bot",
        text: res.data.answer,
        sources: res.data.sources
      }])
    } catch (err) {
      setMessages(prev => [...prev, {
        role: "bot",
        text: "Something went wrong. Please try again.",
        sources: []
      }])
    } finally {
      setAsking(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleAsk()
    }
  }

  function formatMessage(text) {
    if (!text) return "";
    
    // Split by triple backticks for code blocks
    const parts = text.split(/(```[\s\S]*?```)/g);
    return parts.map((part, index) => {
      if (part.startsWith("```") && part.endsWith("```")) {
        const code = part.slice(3, -3).trim();
        const lines = code.split("\n");
        let displayCode = code;
        let lang = "";
        
        // Check if the first line is a language specifier
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
      
      // Split by inline backticks
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
  ]

  return (
    <div className="app-container">
      
      {/* Header / Logo */}
      <div className="logo-area">
        <div className="logo-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
        </div>
        <span className="logo-name">Codebase Chat</span>
      </div>


      {/* Hero Intro */}
      <div className="hero">
        <h1>Understand any codebase, instantly</h1>
        <p>Paste a public GitHub repository URL, ask questions in plain English, and get precise answers with source citations.</p>
      </div>

      {/* Index Repo Card */}
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

        {/* Index Status Info */}
        {indexStatus === "loading" && (
          <div className="status-indicator loading">
            <div className="spinner"></div>
            <span>Cloning and indexing repository — this usually takes 1–2 minutes...</span>
          </div>
        )}
        
        {indexStatus === "success" && indexInfo && (
          <div className="status-indicator success">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>Successfully indexed <strong>{indexInfo.repo}</strong></span>
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

      {/* Stats Dashboard */}
      {indexStatus === "success" && indexInfo && (
        <div className="stats-container">
          <div className="stat-card">
            <div className="stat-value">{indexInfo.total_chunks}</div>
            <div className="stat-label">Functions Indexed</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{indexInfo.files_indexed}</div>
            <div className="stat-label">Files Scanned</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" title={indexInfo.repo}>{indexInfo.repo}</div>
            <div className="stat-label">Active Repo</div>
          </div>
        </div>
      )}

      {/* Chat Interface Card */}
      {indexStatus === "success" && (
        <div className="glass-card chat-window">
          <div className="card-label">Interactive Code Assistant</div>

          {/* Messages Log */}
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
  )
}
