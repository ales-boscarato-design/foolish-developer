'use client'
import React from 'react'

const css = `
  /* Righe più alte nelle liste collezione */
  table tbody tr td {
    padding-top: 10px !important;
    padding-bottom: 10px !important;
    vertical-align: middle !important;
  }
  table tbody tr {
    min-height: 76px;
  }
`

export function AdminStyleProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      {children}
    </>
  )
}
