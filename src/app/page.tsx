"use client";

import { FormEvent, useRef, useState } from "react";

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
  const [input, setInput] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", content: message }]);
    setIsBusy(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message, files: uploads.map((upload) => upload.path) })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Chat failed.");

      setSessionId(data.sessionId);
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content: data.reply }]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", content: error instanceof Error ? error.message : "Chat failed." }
      ]);
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#fff8ed,transparent_34%),linear-gradient(135deg,#f7f2ea,#efe3d2)] px-4 py-6 text-ink sm:px-8">
      <section className="mx-auto grid min-h-[calc(100vh-48px)] max-w-7xl gap-5 lg:grid-cols-[320px_1fr]">
        <aside className="rounded-[2rem] border border-black/10 bg-white/55 p-5 shadow-soft backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-moss">AI Chatbox</p>
          <h1 className="mt-4 text-3xl font-semibold leading-tight">簡單好用的 AI 聊天盒</h1>
          <p className="mt-3 text-sm leading-6 text-black/65">
            這個網頁會把訊息和上傳檔案交給 opencode 處理，讓不熟 terminal 的使用者也能直接操作。
          </p>

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
                  {message.content}
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
