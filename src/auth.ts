/**
 * Operations Control Hub — Auth.js Configuration
 *
 * Credentials provider (email + bcrypt password) with JWT sessions.
 * All session tokens are stored in httpOnly cookies — never accessible
 * to JavaScript running in the browser.
 *
 * Role is embedded in the JWT token and exposed via session.user.role.
 * Middleware (src/middleware.ts) enforces authentication on all routes.
 */

import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

const prisma = new PrismaClient()

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null

        const user = await prisma.user.findUnique({
          where: { email: String(credentials.email) },
          select: {
            id: true,
            email: true,
            name: true,
            passwordHash: true,
            role: true,
            isActive: true,
          },
        })

        if (!user || !user.passwordHash || !user.isActive) return null

        const passwordValid = await bcrypt.compare(
          String(credentials.password),
          user.passwordHash
        )

        if (!passwordValid) return null

        // Never log or return the passwordHash
        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
          role: user.role,
        }
      },
    }),
  ],

  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60, // 8 hours
  },

  callbacks: {
    async jwt({ token, user }) {
      // On sign-in, embed role and id into the token
      if (user) {
        token.id = user.id
        token.role = (user as any).role
      }
      return token
    },
    async session({ session, token }) {
      // Expose id and role on the session object
      if (session.user) {
        session.user.id = token.id as string
        session.user.role = token.role as string
      }
      return session
    },
  },

  pages: {
    signIn: "/login",
  },

  // Cookie security — httpOnly and SameSite=Lax enforced by Auth.js defaults.
  // secure: true is automatic in production (HTTPS).
})
