"use client";

import { FormEvent, useState } from "react";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsBusy(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "登入失敗。");

      const next = new URLSearchParams(window.location.search).get("next");
      const destination = next ? new URL(next, window.location.origin) : new URL("/", window.location.origin);
      window.location.href = destination.origin === window.location.origin ? `${destination.pathname}${destination.search}${destination.hash}` : "/";
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "登入失敗。");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top_left,#fff8ed,transparent_34%),linear-gradient(135deg,#f7f2ea,#efe3d2)] px-4 text-ink">
      <section className="w-full max-w-md rounded-[2rem] border border-black/10 bg-white/75 p-8 shadow-soft backdrop-blur sm:p-10">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-moss">Private Workspace</p>
        <h1 className="mt-4 text-3xl font-semibold">AI ChatBox</h1>
        <p className="mt-2 text-sm text-black/55">登入後繼續使用你的聊天與檔案工作區。</p>

        <form className="mt-8 space-y-5" onSubmit={submit}>
          <label className="block space-y-2 text-sm font-medium">
            <span>帳號</span>
            <input
              autoComplete="username"
              className="w-full rounded-2xl border border-black/10 bg-paper px-4 py-3 outline-none transition focus:border-clay"
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>

          <label className="block space-y-2 text-sm font-medium">
            <span>密碼</span>
            <input
              autoComplete="current-password"
              className="w-full rounded-2xl border border-black/10 bg-paper px-4 py-3 outline-none transition focus:border-clay"
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          {error ? <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

          <button className="w-full rounded-2xl bg-ink px-4 py-3 font-semibold text-white transition hover:bg-black disabled:opacity-60" disabled={isBusy} type="submit">
            {isBusy ? "登入中..." : "登入"}
          </button>
        </form>
      </section>
    </main>
  );
}
