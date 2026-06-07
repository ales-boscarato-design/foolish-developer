import React from 'react'

type MediaDoc = {
  url?: string
  sizes?: { thumbnail?: { url?: string } }
}

type Props = {
  cellData?: unknown
  rowData?: Record<string, unknown>
}

export function ProductImageCell({ rowData }: Props) {
  const images = rowData?.images as Array<{ image?: MediaDoc }> | undefined
  const img = images?.[0]?.image
  const thumbUrl = img?.sizes?.thumbnail?.url ?? img?.url
  const name = rowData?.name as string | undefined

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {thumbUrl ? (
        <img
          src={thumbUrl}
          alt=""
          style={{
            width: 56,
            height: 56,
            objectFit: 'cover',
            borderRadius: 6,
            flexShrink: 0,
            background: '#1a1a1a',
          }}
        />
      ) : (
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 6,
            flexShrink: 0,
            background: '#1a1a1a',
            border: '1px solid #333',
          }}
        />
      )}
      <span style={{ fontWeight: 500 }}>{name ?? '—'}</span>
    </div>
  )
}
