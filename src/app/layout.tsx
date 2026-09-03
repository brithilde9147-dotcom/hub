import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Operations Control Hub',
  description: 'Internal operations dashboard — Ronnie\'s BBQ & Le Box Lunch Cafe',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, background: '#f9fafb' }}>
        {children}
      </body>
    </html>
  )
}
