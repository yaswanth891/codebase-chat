import { useState } from "react"
import axios from "axios"

const API = "https://codebase-chat-itiz.onrender.com"

export default function App() {
  const [githubUrl, setGithubUrl] = useState("")
  const [indexStatus, setIndexStatus] = useState(null) // null | "loading" | "success" | "error"
  const [indexInfo, setIndexInfo] = useState(null)
  const [question, setQuestion] = useState("")
  const [messages, setMessages] = useState([])
  const [asking, setAsking] = useState(false)

  // ── Index a GitHub repo ──────────────────────────────────────────────────
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
      setMessages([]) // clear old chat
    } catch (err) {
      setIndexStatus("error")
    }
  }

  // ── Ask a question ───────────────────────────────────────────────────────
  async function handleAsk() {
    if (!question.trim() || asking) return

    const userMessage = { role: "user", text: question }
    setMessages(prev => [...prev, userMessage])
    setQuestion("")
    setAsking(true)

    try {
      const res = await axios.post(`${API}/query`, { question })
      const botMessage = {
        role: "bot",
        text: res.data.answer,
        sources: res.data.sources
      }
      setMessages(prev => [...prev, botMessage])
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

  // ── Handle Enter key in chat input ───────────────────────────────────────
  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleAsk()
    }
  }

  // ── UI ───────────────────────────────────────────────────────────────────
  return (
    <div style={styles.container}>

      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>Codebase Chat</h1>
        <p style={styles.subtitle}>Ask anything about any GitHub repository</p>
      </div>

      {/* Index Section */}
      <div style={styles.card}>
        <p style={styles.label}>GitHub Repository URL</p>
        <div style={styles.row}>
          <input
            style={styles.input}
            placeholder="https://github.com/tiangolo/fastapi"
            value={githubUrl}
            onChange={e => setGithubUrl(e.target.value)}
            disabled={indexStatus === "loading"}
          />
          <button
            style={{
              ...styles.button,
              opacity: indexStatus === "loading" ? 0.6 : 1
            }}
            onClick={handleIndex}
            disabled={indexStatus === "loading"}
          >
            {indexStatus === "loading" ? "Indexing..." : "Index Repo"}
          </button>
        </div>

        {/* Status messages */}
        {indexStatus === "loading" && (
          <p style={styles.statusBlue}>
            Cloning and indexing repository — this takes 1-2 minutes...
          </p>
        )}
        {indexStatus === "success" && indexInfo && (
          <p style={styles.statusGreen}>
            ✓ Indexed {indexInfo.total_chunks} functions across {indexInfo.files_indexed} files in {indexInfo.repo}
          </p>
        )}
        {indexStatus === "error" && (
          <p style={styles.statusRed}>
            Failed to index. Make sure it's a public GitHub URL.
          </p>
        )}
      </div>

      {/* Chat Section — only show after indexing */}
      {indexStatus === "success" && (
        <div style={styles.card}>

          {/* Messages */}
          <div style={styles.messages}>
            {messages.length === 0 && (
              <p style={styles.emptyChat}>
                Ask anything about the codebase — "How does routing work?", "What does X function do?"
              </p>
            )}
            {messages.map((msg, i) => (
              <div key={i} style={msg.role === "user" ? styles.userMsg : styles.botMsg}>
                <p style={styles.msgText}>{msg.text}</p>
                {msg.sources && msg.sources.length > 0 && (
                  <div style={styles.sources}>
                    {msg.sources.map((s, j) => (
                      <span key={j} style={styles.sourceChip}>
                        {s.file.split("/").pop()} :: {s.function_name}() line {s.start_line}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {asking && (
              <div style={styles.botMsg}>
                <p style={styles.msgText}>Thinking...</p>
              </div>
            )}
          </div>

          {/* Input */}
          <div style={styles.row}>
            <input
              style={styles.input}
              placeholder="Ask a question about the codebase..."
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={asking}
            />
            <button
              style={{ ...styles.button, opacity: asking ? 0.6 : 1 }}
              onClick={handleAsk}
              disabled={asking}
            >
              Ask
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────────
const styles = {
  container: {
    maxWidth: "800px",
    margin: "0 auto",
    padding: "40px 20px",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    backgroundColor: "#f9fafb",
    minHeight: "100vh",
  },
  header: {
    marginBottom: "32px",
  },
  title: {
    fontSize: "28px",
    fontWeight: "700",
    color: "#111827",
    margin: "0 0 8px",
  },
  subtitle: {
    fontSize: "15px",
    color: "#6b7280",
    margin: 0,
  },
  card: {
    backgroundColor: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "12px",
    padding: "24px",
    marginBottom: "20px",
  },
  label: {
    fontSize: "13px",
    fontWeight: "500",
    color: "#374151",
    marginBottom: "8px",
  },
  row: {
    display: "flex",
    gap: "10px",
  },
  input: {
    flex: 1,
    padding: "10px 14px",
    fontSize: "14px",
    border: "1px solid #d1d5db",
    borderRadius: "8px",
    outline: "none",
    backgroundColor: "#f9fafb",
  },
  button: {
    padding: "10px 20px",
    fontSize: "14px",
    fontWeight: "500",
    backgroundColor: "#111827",
    color: "#ffffff",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
  },
  statusBlue: {
    fontSize: "13px",
    color: "#1d4ed8",
    marginTop: "10px",
  },
  statusGreen: {
    fontSize: "13px",
    color: "#15803d",
    marginTop: "10px",
  },
  statusRed: {
    fontSize: "13px",
    color: "#dc2626",
    marginTop: "10px",
  },
  messages: {
    minHeight: "200px",
    maxHeight: "400px",
    overflowY: "auto",
    marginBottom: "16px",
  },
  emptyChat: {
    fontSize: "13px",
    color: "#9ca3af",
    textAlign: "center",
    marginTop: "80px",
  },
  userMsg: {
    backgroundColor: "#111827",
    color: "#ffffff",
    borderRadius: "12px 12px 4px 12px",
    padding: "12px 16px",
    marginBottom: "12px",
    marginLeft: "60px",
  },
  botMsg: {
    backgroundColor: "#f3f4f6",
    borderRadius: "12px 12px 12px 4px",
    padding: "12px 16px",
    marginBottom: "12px",
    marginRight: "60px",
  },
  msgText: {
    fontSize: "14px",
    lineHeight: "1.6",
    margin: "0 0 8px",
    color: "inherit",
    whiteSpace: "pre-wrap",
  },
  sources: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
    marginTop: "8px",
  },
  sourceChip: {
    fontSize: "11px",
    backgroundColor: "#e5e7eb",
    color: "#374151",
    padding: "3px 8px",
    borderRadius: "20px",
  },
}