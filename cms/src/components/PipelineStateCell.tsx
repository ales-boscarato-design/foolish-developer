import React from 'react'

const STATES: Record<string, { label: string; color: string }> = {
  received:         { label: 'Ricevuto',       color: '#6366f1' },
  eta_pending:      { label: 'Attesa ETA',      color: '#f59e0b' },
  eta_confirmed:    { label: 'ETA confermato',  color: '#3b82f6' },
  in_production:    { label: 'In produzione',   color: '#a855f7' },
  matching_pending: { label: 'Matching',        color: '#f97316' },
  matched:          { label: 'Abbinato',        color: '#06b6d4' },
  preview_sent:     { label: 'Preview inviata', color: '#0ea5e9' },
  shipped:          { label: 'Spedito',         color: '#10b981' },
  delivered:        { label: 'Consegnato',      color: '#22c55e' },
  followup_done:    { label: 'Follow-up',       color: '#84cc16' },
  closed:           { label: 'Chiuso',          color: '#6b7280' },
}

type Props = {
  cellData?: unknown
  rowData?: Record<string, unknown>
}

export function PipelineStateCell({ cellData }: Props) {
  const state = cellData as string | undefined
  const info = state ? STATES[state] : undefined

  if (!info) return <span style={{ color: '#6b7280' }}>{state ?? '—'}</span>

  return (
    <span
      style={{
        display: 'inline-block',
        background: info.color + '22',
        color: info.color,
        border: `1px solid ${info.color}55`,
        borderRadius: 5,
        padding: '3px 10px',
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        letterSpacing: '0.02em',
      }}
    >
      {info.label}
    </span>
  )
}
