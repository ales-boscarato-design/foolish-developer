'use client'
// Zustand richiede un client boundary per la persistenza
export function CartProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
