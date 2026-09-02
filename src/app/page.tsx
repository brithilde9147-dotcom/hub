import { auth } from "@/auth"
import { redirect } from "next/navigation"

export default async function DashboardPage() {
  const session = await auth()
  if (!session) redirect("/login")
  return (
    <main style={{padding:"2rem", fontFamily:"system-ui, sans-serif"}}>
      <h1 style={{fontSize:"1.5rem", fontWeight:700}}>Operations Control Hub</h1>
      <p style={{color:"#6b7280"}}>Signed in as <strong>{session.user?.email}</strong></p>
      <div style={{marginTop:"1rem", padding:"1rem", background:"#f9fafb", borderRadius:"8px", border:"1px solid #e5e7eb"}}>
        ✅ Auth is working. Dashboard UI coming in Phase 2.
      </div>
    </main>
  )
}