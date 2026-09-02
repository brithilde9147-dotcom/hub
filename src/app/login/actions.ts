"use server"

/**
 * Operations Control Hub — Login Server Action
 *
 * Handles form submission from /login page.
 * Delegates credential validation to Auth.js (which calls bcrypt internally).
 * On success, Auth.js sets the session cookie automatically.
 */

import { signIn } from "@/auth"
import { AuthError } from "next-auth"
import { redirect } from "next/navigation"

export async function loginAction(
  _prevState: { error: string } | null,
  formData: FormData
): Promise<{ error: string }> {
  const email = formData.get("email") as string
  const password = formData.get("password") as string
  const callbackUrl = (formData.get("callbackUrl") as string) || "/"

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: callbackUrl,
    })
  } catch (err) {
    if (err instanceof AuthError) {
      switch (err.type) {
        case "CredentialsSignin":
          return { error: "Invalid email or password." }
        default:
          return { error: "Something went wrong. Please try again." }
      }
    }
    // Auth.js throws a redirect internally on success — re-throw it
    throw err
  }

  // Should not be reached; Auth.js redirects on success
  redirect(callbackUrl)
}
