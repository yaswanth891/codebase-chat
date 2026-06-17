import { useState } from "react"
import axios from "axios"

const API = import.meta.env.VITE_API_URL || "https://codebase-chat-itiz.onrender.com"

export default function App() {
  const [githubUrl, setGithubUrl] = useState("")
  const [indexStatus, setIndexStatus] = useState(null)
  const [indexInfo, setIndexInfo] = useState(null)
  const [question, setQuestion] = useState("")
  const [messages, setMessages] = useState([])
  const [asking, setAsking] = useState(false)

  async function handleIndex() {
    if (!githubUrl.trim()) return
    setIndexStatus("loading")
    setIndexInfo(null)
    try {
      const res = await axios.post(`${API}/index-github`, {
        github_url: githubUrl
      })
      setIndexInfo(res.data)
      setIndexStatus("success")
      setMessages([])
    } catch (err) {
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

  const suggestions = [
    "How does routing work?",
    "What is the request lifecycle?",
    "How are errors handled?",
  ]

  return (
    <div style={s.page}>
      <div style={s.app}>

        {/* Logo */}
        <div style={s.logo}>
          <div style={s.logoIcon}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
            </svg>
          </div>
          <span style={s.logoName}>Codebase Chat</span>
          <span style={s.badge}>beta</span>
        </div>

        {/* Hero */}
        <div style={s.hero}>
          <h1 style={s.h1}>Understand any codebase, instantly</h1>
          <p style={s.sub}>Paste a GitHub URL, ask questions in plain English, get answers with exact file and line references.</p>
        </div>

        {/* Index */}
        <div style={s.card}>
          <div style={s.label}>Repository</div>
          <div style={s.row}>
            <div style={s.inputWrap}>
              <span style={s.inputIcon}>#</span>
              <input
                style={s.input}
                type="text"
                placeholder="https://github.com/owner/repo"
                value={githubUrl}
                onChange={e => setGithubUrl(e.target.value)}
                disabled={indexStatus === "loading"}
              />
            </div>
            <button
              style={{ ...s.btn, opacity: (indexStatus === "loading" || !githubUrl.trim()) ? 0.5 : 1 }}
              onClick={handleIndex}
              disabled={indexStatus === "loading" || !githubUrl.trim()}
            >
              {indexStatus === "loading" ? "Indexing..." : "Index repo"}
            </button>
          </div>

          {indexStatus === "loading" && (
            <p style={s.statusText}>Cloning and indexing — takes 1–2 minutes...</p>
          )}
          {indexStatus === "success" && indexInfo && (
            <p style={s.statusText}>
              ✓ Indexed {indexInfo.total_chunks} functions across {indexInfo.files_indexed} files in <strong>{indexInfo.repo}</strong>
            </p>
          )}
          {indexStatus === "error" && (
            <p style={{ ...s.statusText, color: "#dc2626" }}>
              Could not index. Make sure the repo is public and try again.
            </p>
          )}
        </div>

        {/* Stats */}
        {indexStatus === "success" && indexInfo && (
          <div style={s.stats}>
            {[
              { val: indexInfo.total_chunks, label: "Functions indexed" },
              { val: indexInfo.files_indexed, label: "Files scanned" },
              { val: indexInfo.repo, label: "Active repo" },
            ].map((stat, i) => (
              <div key={i} style={s.stat}>
                <div style={s.statVal}>{stat.val}</div>
                <div style={s.statLabel}>{stat.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Chat */}
        {indexStatus === "success" && (
          <div style={s.card}>

            {/* Messages */}
            <div style={s.chatArea}>
              {messages.length === 0 && (
                <div style={s.emptyState}>
                  <p style={s.emptyText}>Ask anything about the codebase</p>
                  <div style={s.suggestions}>
                    {suggestions.map((q, i) => (
                      <button key={i} style={s.suggestion} onClick={() => handleAsk(q)}>
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((msg, i) => (
                <div key={i} style={msg.role === "user" ? s.msgUser : s.msgBot}>
                  <div style={msg.role === "user" ? s.bubbleUser : s.bubbleBot}>
                    {msg.text}
                  </div>
                  {msg.sources && msg.sources.length > 0 && (
                    <div style={s.citations}>
                      {msg.sources.map((src, j) => (
                        <span key={j} style={s.cite}>
                          {src.file.split("/").pop()} · {src.function_name}() line {src.start_line}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {asking && (
                <div style={s.msgBot}>
                  <div style={s.bubbleBot}>Thinking...</div>
                </div>
              )}
            </div>

            <div style={s.divider} />

            {/* Input */}
            <div style={s.row}>
              <div style={s.inputWrap}>
                <span style={s.inputIcon}>›</span>
                <input
                  style={s.input}
                  type="text"
                  placeholder="Ask anything about the codebase..."
                  value={question}
                  onChange={e => setQuestion(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={asking}
                />
              </div>
              <button
                style={{ ...s.btn, opacity: asking ? 0.5 : 1 }}
                onClick={() => handleAsk()}
                disabled={asking}
              >
                Ask
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

const s = {
  page: {
    backgroundColor: "#fafafa",
    minHeight: "100vh",
    padding: "0 16px",
  },
  app: {
    maxWidth: "680px",
    margin: "0 auto",
    padding: "48px 0 80px",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif",
  },
  logo: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginBottom: "32px",
  },
  logoIcon: {
    width: "28px",
    height: "28px",
    backgroundColor: "#111827",
    borderRadius: "7px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#ffffff",
  },
  logoName: {
    fontSize: "15px",
    fontWeight: "500",
    color: "#111827",
  },
  badge: {
    fontSize: "11px",
    padding: "2px 7px",
    borderRadius: "20px",
    border: "1px solid #e5e7eb",
    color: "#9ca3af",
    marginLeft: "2px",
  },
  hero: { marginBottom: "28px" },
  h1: {
    fontSize: "22px",
    fontWeight: "500",
    color: "#111827",
    margin: "0 0 8px",
    letterSpacing: "-0.01em",
  },
  sub: {
    fontSize: "14px",
    color: "#6b7280",
    lineHeight: "1.6",
    margin: 0,
  },
  card: {
    backgroundColor: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "12px",
    padding: "20px",
    marginBottom: "10px",
  },
  label: {
    fontSize: "12px",
    fontWeight: "500",
    color: "#6b7280",
    marginBottom: "8px",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  inputWrap: { position: "relative", flex: 1 },
  inputIcon: {
    position: "absolute",
    left: "11px",
    top: "50%",
    transform: "translateY(-50%)",
    fontSize: "14px",
    color: "#9ca3af",
    pointerEvents: "none",
  },
  input: {
    width: "100%",
    padding: "9px 12px 9px 30px",
    fontSize: "13px",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    backgroundColor: "#f9fafb",
    color: "#111827",
    outline: "none",
    fontFamily: "inherit",
  },
  hint: {
    fontSize: "12px",
    color: "#9ca3af",
    marginTop: "8px",
    lineHeight: "1.5",
  },
  link: {
    color: "#6b7280",
    textDecoration: "underline",
    textUnderlineOffset: "2px",
  },
  row: { display: "flex", gap: "8px" },
  btn: {
    padding: "9px 16px",
    fontSize: "13px",
    fontWeight: "500",
    backgroundColor: "#111827",
    color: "#ffffff",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    whiteSpace: "nowrap",
    fontFamily: "inherit",
  },
  statusText: {
    fontSize: "13px",
    color: "#6b7280",
    marginTop: "10px",
    lineHeight: "1.5",
  },
  stats: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "8px",
    marginBottom: "10px",
  },
  stat: {
    backgroundColor: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "10px",
    padding: "14px 16px",
  },
  statVal: {
    fontSize: "18px",
    fontWeight: "500",
    color: "#111827",
  },
  statLabel: {
    fontSize: "11px",
    color: "#9ca3af",
    marginTop: "3px",
  },
  chatArea: {
    minHeight: "220px",
    maxHeight: "380px",
    overflowY: "auto",
    marginBottom: "16px",
  },
  emptyState: {
    paddingTop: "40px",
    textAlign: "center",
  },
  emptyText: {
    fontSize: "13px",
    color: "#9ca3af",
    marginBottom: "14px",
  },
  suggestions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
    justifyContent: "center",
  },
  suggestion: {
    fontSize: "12px",
    padding: "6px 12px",
    border: "1px solid #e5e7eb",
    borderRadius: "20px",
    color: "#6b7280",
    backgroundColor: "transparent",
    cursor: "pointer",
    fontFamily: "inherit",
  },
  msgUser: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    marginBottom: "12px",
  },
  msgBot: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    marginBottom: "12px",
  },
  bubbleUser: {
    backgroundColor: "#111827",
    color: "#ffffff",
    padding: "10px 14px",
    borderRadius: "12px 12px 3px 12px",
    fontSize: "13px",
    lineHeight: "1.6",
    maxWidth: "85%",
  },
  bubbleBot: {
    backgroundColor: "#f3f4f6",
    color: "#111827",
    padding: "10px 14px",
    borderRadius: "12px 12px 12px 3px",
    fontSize: "13px",
    lineHeight: "1.6",
    maxWidth: "85%",
    whiteSpace: "pre-wrap",
  },
  citations: {
    display: "flex",
    flexWrap: "wrap",
    gap: "5px",
    marginTop: "6px",
  },
  cite: {
    fontSize: "11px",
    padding: "3px 9px",
    border: "1px solid #e5e7eb",
    borderRadius: "20px",
    color: "#6b7280",
    backgroundColor: "#ffffff",
  },
  divider: {
    height: "1px",
    backgroundColor: "#f3f4f6",
    margin: "0 0 16px",
  },
}
