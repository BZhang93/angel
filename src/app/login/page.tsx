"use client";

import { useState } from "react";
import { login, signup, type AuthResult } from "./actions";

export default function LoginPage() {
  const [result, setResult] = useState<AuthResult | null>(null);
  const [pending, setPending] = useState(false);

  async function run(action: (form: FormData) => Promise<AuthResult | void>, form: FormData) {
    setPending(true);
    setResult((await action(form)) ?? null);
    setPending(false);
  }

  return (
    <div className="flex min-h-full flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <h1 className="text-lg font-semibold">Angel</h1>
        <p className="mt-1 text-sm text-muted">
          Private portfolio tracker. Sign in to continue.
        </p>

        <form
          className="mt-6 space-y-3"
          action={(form) => run(login, form)}
        >
          <label className="block text-sm">
            <span className="text-muted">Email</span>
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted">Password</span>
            <input
              type="password"
              name="password"
              required
              autoComplete="current-password"
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
            />
          </label>

          {result?.status === "error" && (
            <p className="text-sm text-negative">{result.message}</p>
          )}
          {result?.status === "confirm-email" && (
            <p className="text-sm text-muted">
              Check your email for a confirmation link, then sign in.
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={pending}
              className="flex-1 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {pending ? "Working…" : "Sign in"}
            </button>
            <button
              type="submit"
              disabled={pending}
              formAction={(form) => run(signup, form)}
              className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-60"
            >
              Create account
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
