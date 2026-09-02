"use client"

/**
 * Operations Control Hub — Login Page (/login)
 *
 * Simple credentials form. Submits via the loginAction server action.
 * Auth.js sets the session cookie on success and redirects to callbackUrl.
 *
 * Intentionally minimal — no brand assets or external dependencies beyond
 * Tailwind (already included via create-next-app).
 */

import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { useSearchParams } from "next/navigation"
import { loginAction } from "./actions"
import { Suspense } from "react"

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
    >
      {pending ? "Signing in…" : "Sign in"}
    </button>
  )
}

function LoginForm() {
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get("callbackUrl") ?? "/"

  const [state, action] = useActionState(loginAction, null)

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="callbackUrl" value={callbackUrl} />

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-gray-700">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-gray-700">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
        />
      </div>

      {state?.error && (
        <p className="text-sm text-red-600" role="alert">
          {state.error}
        </p>
      )}

      <SubmitButton />
    </form>
  )
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm rounded-xl bg-white p-8 shadow-sm ring-1 ring-gray-200">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-gray-900">Operations Control Hub</h1>
          <p className="mt-1 text-sm text-gray-500">Sign in to continue</p>
        </div>
        {/* Suspense required because useSearchParams reads from the URL */}
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  )
}
