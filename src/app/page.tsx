"use client";

import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type Upload = {
  name: string;
  path: string;
  size: number;
  type: string;
};

type OutputFile = {
  name: string;
  path: string;
  size: number;
  updatedAt: string;
};

type SessionSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

type StoredMessage = Message & {
  createdAt?: string;
};

function cleanInlineMarkdown(value: string) {
  return value.replace(/`([^`]+)`/g, "$1").replace(/\*\*(.*?)\*\*/g, "$1").replace(/__(.*?)__/g, "$1");
}

function renderMessageContent(content: string) {
  const lines = content.split("\n");
  const nodes: ReactNode[] = [];
  let tableRows: string[][] = [];

  function flushTable() {
    if (tableRows.length === 0) return;

    const rows = tableRows.filter((row) => !row.every((cell) => /^:?-{3,}:?$/.test(cell.trim())));
    const header = rows[0];
    const body = rows.slice(1);
    const key = `table-${nodes.length}`;

    nodes.push(
      <div key={key} className="my-3 overflow-x-auto rounded-2xl border border-black/10 bg-white/70">
        <table className="min-w-full text-left text-xs">
          {header ? (
            <thead className="bg-black/5 text-black/70">
              <tr>{header.map((cell, index) => <th key={index} className="px-3 py-2 font-semibold">{cleanInlineMarkdown(cell)}</th>)}</tr>
            </thead>
          ) : null}
          <tbody>
            {body.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-t border-black/10">
                {row.map((cell, cellIndex) => <td key={cellIndex} className="px-3 py-2 align-top">{cleanInlineMarkdown(cell)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    tableRows = [];
  }

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const tableCells = trimmed.startsWith("|") && trimmed.endsWith("|") ? trimmed.slice(1, -1).split("|").map((cell) => cell.trim()) : null;

    if (tableCells && tableCells.length > 1) {
      tableRows.push(tableCells);
      return;
    }

    flushTable();

    if (!trimmed) {
      nodes.push(<div key={index} className="h-2" />);
      return;
    }

    const heading = trimmed.match(/^#{1,4}\s+(.+)$/);
    if (heading) {
      nodes.push(<p key={index} className="mt-3 font-semibold">{cleanInlineMarkdown(heading[1])}</p>);
      return;
    }

    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      nodes.push(<p key={index} className="pl-4 before:mr-2 before:content-['•']">{cleanInlineMarkdown(bullet[1])}</p>);
      return;
    }

    const numbered = trimmed.match(/^\d+\.\s+(.+)$/);
    if (numbered) {
      nodes.push(<p key={index} className="pl-4">{cleanInlineMarkdown(trimmed)}</p>);
      return;
    }

    nodes.push(<p key={index}>{cleanInlineMarkdown(trimmed.replace(/^>\s*/, ""))}</p>);
  });

  flushTable();

  return nodes;
}

export default function Home() {
  const [sessionId, setSessionId] = useState<string>();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "把檔案拖進來，或直接告訴我你想請 AI 做什麼。"
    }
  ]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [outputs, setOutputs] = useState<OutputFile[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("opencode-go/deepseek-v4-flash");
  const [customModel, setCustomModel] = useState("");
  const [input, setInput] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/models")
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled && Array.isArray(data.models)) setModelOptions(data.models);
      })
      .catch(() => {
        if (!cancelled) setModelOptions([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    refreshSessions();
  }, []);

  const activeModel = selectedModel === "custom" ? customModel.trim() : selectedModel === "default" ? "" : selectedModel;

  async function refreshOutputs(nextSessionId = sessionId) {
    if (!nextSessionId) {
      setOutputs([]);
      return;
    }

    const response = await fetch(`/api/outputs?sessionId=${encodeURIComponent(nextSessionId)}`);
    const data = await response.json();

    if (response.ok && Array.isArray(data.outputs)) {
      setOutputs(data.outputs);
    }
  }

  async function refreshSessions() {
    const response = await fetch("/api/sessions");
    const data = await response.json();

    if (response.ok && Array.isArray(data.sessions)) {
      setSessions(data.sessions);
    }
  }

  async function startNewSession() {
    const response = await fetch("/api/sessions", { method: "POST" });
    const data = await response.json();
    const nextSession = data.session as SessionSummary;

    setSessionId(nextSession.id);
    setUploads([]);
    setOutputs([]);
    setMessages([{ id: "welcome", role: "assistant", content: "把檔案拖進來，或直接告訴我你想請 AI 做什麼。" }]);
    await refreshSessions();
  }

  async function loadSession(nextSessionId: string) {
    const response = await fetch(`/api/sessions/${encodeURIComponent(nextSessionId)}`);
    const data = await response.json();

    if (!response.ok) return;

    setSessionId(nextSessionId);
    setUploads(Array.isArray(data.uploads) ? data.uploads : []);
    setOutputs(Array.isArray(data.outputs) ? data.outputs : []);
    setMessages(
      Array.isArray(data.messages) && data.messages.length > 0
        ? data.messages.map((message: StoredMessage) => ({ id: message.id, role: message.role, content: message.content }))
        : [{ id: "welcome", role: "assistant", content: "這個聊天還沒有訊息。" }]
    );
  }

  async function deleteChatSession(targetSessionId: string) {
    if (!window.confirm("確定要刪除這個聊天記錄嗎？")) return;

    await fetch(`/api/sessions/${encodeURIComponent(targetSessionId)}`, { method: "DELETE" });
    await refreshSessions();

    if (targetSessionId === sessionId) {
      setSessionId(undefined);
      setUploads([]);
      setOutputs([]);
      setMessages([{ id: "welcome", role: "assistant", content: "把檔案拖進來，或直接告訴我你想請 AI 做什麼。" }]);
    }
  }

  async function uploadFiles(files: FileList | File[]) {
    const picked = Array.from(files);
    if (picked.length === 0) return;

    const form = new FormData();
    if (sessionId) form.append("sessionId", sessionId);
    picked.forEach((file) => form.append("files", file));

    setIsBusy(true);
    try {
      const response = await fetch("/api/upload", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Upload failed.");

      setSessionId(data.sessionId);
      setUploads((current) => [...current, ...data.uploads]);
      await refreshSessions();
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `已上傳 ${data.uploads.length} 個檔案，可以開始描述你要我怎麼處理。`
        }
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", content: error instanceof Error ? error.message : "Upload failed." }
      ]);
    } finally {
      setIsBusy(false);
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = input.trim();
    if (!message || isBusy) return;

    setInput("");
    const pendingId = crypto.randomUUID();
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", content: message },
      { id: pendingId, role: "assistant", content: "opencode 已開始處理，會盡量即時顯示可用的回覆內容。" }
    ]);
    setIsBusy(true);

    try {
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message, model: activeModel, files: uploads.map((upload) => upload.path) })
      });

      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error([data.error, data.detail].filter(Boolean).join("\n") || "Chat failed.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamedText = "";
      let finalSessionId = sessionId;

      const handleEvent = (eventName: string, rawData: string) => {
        const data = JSON.parse(rawData) as { sessionId?: string; chunk?: string; output?: string; detail?: string; message?: string };

        if (eventName === "session" && data.sessionId) {
          finalSessionId = data.sessionId;
          setSessionId(data.sessionId);
          return;
        }

        if (eventName === "chunk" && data.chunk) {
          streamedText += data.chunk;
          setMessages((current) => current.map((item) => (item.id === pendingId ? { ...item, content: streamedText } : item)));
          return;
        }

        if (eventName === "status" && data.message && !streamedText) {
          const statusMessage = data.message;
          setMessages((current) => current.map((item) => (item.id === pendingId ? { ...item, content: statusMessage } : item)));
          return;
        }

        if (eventName === "done") {
          streamedText = data.output || streamedText || "opencode completed without text output.";
          setMessages((current) => current.map((item) => (item.id === pendingId ? { ...item, content: streamedText } : item)));
          if (data.sessionId) finalSessionId = data.sessionId;
          return;
        }

        if (eventName === "error") {
          throw new Error(data.detail || "Chat failed.");
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const eventBlock of events) {
          const eventLine = eventBlock.split("\n").find((line) => line.startsWith("event: "));
          const dataLine = eventBlock.split("\n").find((line) => line.startsWith("data: "));

          if (!eventLine || !dataLine) continue;

          handleEvent(eventLine.slice(7), dataLine.slice(6));
        }
      }

      await refreshOutputs(finalSessionId);
      await refreshSessions();
    } catch (error) {
      setMessages((current) =>
        current.map((item) =>
          item.id === pendingId ? { ...item, content: error instanceof Error ? error.message : "Chat failed." } : item
        )
      );
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#fff8ed,transparent_34%),linear-gradient(135deg,#f7f2ea,#efe3d2)] px-4 py-6 text-ink sm:px-8">
      <section className="mx-auto grid min-h-[calc(100vh-48px)] max-w-7xl gap-5 lg:grid-cols-[320px_1fr]">
        <aside className="rounded-[2rem] border border-black/10 bg-white/55 p-5 shadow-soft backdrop-blur">
          <h1 className="text-3xl font-semibold leading-tight">AI ChatBox</h1>

          <button
            className="mt-6 w-full rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-black disabled:opacity-60"
            disabled={isBusy}
            onClick={startNewSession}
            type="button"
          >
            新聊天
          </button>

          <div className="mt-6 space-y-3">
            <p className="text-sm font-semibold">聊天記錄</p>
            {sessions.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-black/15 p-4 text-sm text-black/50">還沒有聊天記錄</p>
            ) : (
              <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
                {sessions.map((session) => (
                  <div
                    key={session.id}
                    className={`group flex items-start gap-2 rounded-2xl p-3 text-sm transition ${
                      session.id === sessionId ? "bg-ink text-white" : "bg-white/70 hover:bg-white"
                    }`}
                  >
                    <button className="min-w-0 flex-1 text-left" disabled={isBusy} onClick={() => loadSession(session.id)} type="button">
                      <p className="truncate font-medium">{session.title}</p>
                      <p className={`mt-1 text-xs ${session.id === sessionId ? "text-white/60" : "text-black/45"}`}>
                        {new Date(session.updatedAt).toLocaleString("zh-TW")}
                      </p>
                    </button>
                    <button
                      className={`rounded-full px-2 text-base leading-6 opacity-70 transition hover:opacity-100 ${
                        session.id === sessionId ? "text-white" : "text-black/60"
                      }`}
                      disabled={isBusy}
                      onClick={() => deleteChatSession(session.id)}
                      title="刪除聊天"
                      type="button"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            className="mt-6 w-full rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-black disabled:opacity-60"
            disabled={isBusy}
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            選擇檔案上傳
          </button>
          <input ref={fileInputRef} className="hidden" multiple type="file" onChange={(event) => event.target.files && uploadFiles(event.target.files)} />

          <div className="mt-6 space-y-3">
            <label className="text-sm font-semibold" htmlFor="model-select">
              使用模型
            </label>
            <select
              id="model-select"
              className="w-full rounded-2xl border border-black/10 bg-white/80 px-4 py-3 text-sm outline-none transition focus:border-clay"
              value={selectedModel}
              onChange={(event) => setSelectedModel(event.target.value)}
            >
              <option value="default">opencode 預設模型</option>
              {modelOptions.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
              <option value="custom">自訂模型名稱</option>
            </select>
            {selectedModel === "custom" ? (
              <input
                className="w-full rounded-2xl border border-black/10 bg-white/80 px-4 py-3 text-sm outline-none transition placeholder:text-black/40 focus:border-clay"
                placeholder="例如：opencode/grok-code-fast-1"
                value={customModel}
                onChange={(event) => setCustomModel(event.target.value)}
              />
            ) : null}
            <p className="text-xs leading-5 text-black/50">Go 訂閱請選 opencode-go/*。若選 opencode/* 會走 Zen 餘額。</p>
          </div>

          <div className="mt-6 space-y-3">
            <p className="text-sm font-semibold">已上傳檔案</p>
            {uploads.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-black/15 p-4 text-sm text-black/50">還沒有檔案</p>
            ) : (
              uploads.map((upload) => (
                <div key={upload.path} className="rounded-2xl bg-white/70 p-3 text-sm">
                  <p className="truncate font-medium">{upload.name}</p>
                  <p className="mt-1 text-xs text-black/50">{Math.ceil(upload.size / 1024)} KB</p>
                </div>
              ))
            )}
          </div>

          <div className="mt-6 space-y-3">
            <p className="text-sm font-semibold">產出檔案</p>
            {outputs.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-black/15 p-4 text-sm text-black/50">還沒有可下載檔案</p>
            ) : (
              outputs.map((output) => (
                <a
                  key={output.path}
                  className="block rounded-2xl bg-white/80 p-3 text-sm transition hover:bg-white"
                  href={`/api/download?sessionId=${encodeURIComponent(sessionId || "")}&file=${encodeURIComponent(output.name)}`}
                >
                  <p className="truncate font-medium text-ink">{output.name}</p>
                  <p className="mt-1 text-xs text-black/50">下載 · {Math.ceil(output.size / 1024)} KB</p>
                </a>
              ))
            )}
          </div>
        </aside>

        <section
          className="flex min-h-[640px] flex-col overflow-hidden rounded-[2rem] border border-black/10 bg-white/70 shadow-soft backdrop-blur"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            uploadFiles(event.dataTransfer.files);
          }}
        >
          <div className="border-b border-black/10 px-5 py-4">
            <p className="text-sm font-semibold">聊天工作區</p>
            <p className="text-xs text-black/50">拖拉檔案到這裡，或輸入任務需求。</p>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            {messages.map((message) => (
              <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[82%] whitespace-pre-wrap rounded-[1.4rem] px-4 py-3 text-sm leading-6 ${
                    message.role === "user" ? "bg-ink text-white" : "bg-paper text-ink"
                  }`}
                >
                  <div className="space-y-1">{message.role === "assistant" ? renderMessageContent(message.content) : message.content}</div>
                </div>
              </div>
            ))}
          </div>

          <form className="border-t border-black/10 p-4" onSubmit={sendMessage}>
            <div className="flex gap-3 rounded-3xl bg-paper p-2">
              <textarea
                className="min-h-12 flex-1 resize-none bg-transparent px-3 py-3 text-sm outline-none placeholder:text-black/40"
                placeholder="例如：幫我整理這份 PDF，輸出重點摘要和待辦事項"
                rows={1}
                value={input}
                onChange={(event) => setInput(event.target.value)}
              />
              <button
                className="rounded-2xl bg-clay px-5 py-3 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-50"
                disabled={isBusy || !input.trim()}
                type="submit"
              >
                {isBusy ? "處理中" : "送出"}
              </button>
            </div>
          </form>
        </section>
      </section>
    </main>
  );
}
