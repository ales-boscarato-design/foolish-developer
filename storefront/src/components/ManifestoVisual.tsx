'use client'

import Image from 'next/image'
import { motion } from 'framer-motion'

export type VisualKind = 'unique' | 'crafted' | 'flock'

interface Props {
  kind: VisualKind
  src?: string
  alt?: string
}

/**
 * Visual atmosferico per il manifesto sticky.
 * - Se `src` è fornito: usa next/image come background.
 * - Altrimenti: rende un placeholder SVG astratto on-brand (accent color).
 * In entrambi i casi: gradient mask sinistro per garantire leggibilità del testo.
 */
export function ManifestoVisual({ kind, src, alt }: Props) {
  return (
    <>
      <div
        className="absolute inset-y-0 right-0 w-full md:w-[60%] pointer-events-none"
        aria-hidden={!alt}
        style={{
          maskImage:
            'linear-gradient(to right, transparent 0%, black 35%, black 100%)',
          WebkitMaskImage:
            'linear-gradient(to right, transparent 0%, black 35%, black 100%)',
        }}
      >
        {src ? (
          <Image
            src={src}
            alt={alt ?? ''}
            fill
            sizes="(max-width: 768px) 100vw, 60vw"
            className={`object-cover opacity-40 ${
              kind === 'flock'
                ? 'object-[30%_50%] md:object-center'
                : 'object-center'
            }`}
            priority={false}
          />
        ) : (
          <PlaceholderArt kind={kind} />
        )}
      </div>
      {/* Mobile scrim — staccare il testo dall'immagine per leggibilità.
          Dark solido a sinistra dove vive il testo, sfuma a destra per
          mantenere parte dell'atmosfera visiva. */}
      <div
        className="absolute inset-0 md:hidden pointer-events-none"
        aria-hidden
        style={{
          background:
            'linear-gradient(to right, var(--background) 0%, var(--background) 35%, rgba(8,8,8,0.75) 65%, rgba(8,8,8,0.45) 100%)',
        }}
      />
    </>
  )
}

function PlaceholderArt({ kind }: { kind: VisualKind }) {
  if (kind === 'unique') return <UniqueArt />
  if (kind === 'crafted') return <CraftedArt />
  return <FlockArt />
}

/* ── 1. UNIQUE — 4 macchie irregolari di tonalità accent ─────────── */
function UniqueArt() {
  const blobs = [
    { cx: 30, cy: 30, rx: 22, ry: 18, op: 0.4, dur: 11 },
    { cx: 65, cy: 25, rx: 16, ry: 20, op: 0.32, dur: 13 },
    { cx: 35, cy: 70, rx: 19, ry: 14, op: 0.28, dur: 9 },
    { cx: 70, cy: 68, rx: 14, ry: 22, op: 0.36, dur: 12 },
  ]
  return (
    <svg
      className="absolute inset-0 w-full h-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <radialGradient id="uniqueGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--accent)" />
          <stop offset="100%" stopColor="var(--accent-dark)" />
        </radialGradient>
      </defs>
      {blobs.map((b, i) => (
        <motion.ellipse
          key={i}
          cx={b.cx}
          cy={b.cy}
          rx={b.rx}
          ry={b.ry}
          fill="url(#uniqueGrad)"
          opacity={b.op}
          animate={{
            rx: [b.rx, b.rx + 1.5, b.rx - 1, b.rx],
            ry: [b.ry, b.ry - 1, b.ry + 1.5, b.ry],
          }}
          transition={{
            duration: b.dur,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
          style={{ filter: 'blur(0.6px)' }}
        />
      ))}
    </svg>
  )
}

/* ── 2. CRAFTED — colata verticale di silicone ──────────────────── */
function CraftedArt() {
  return (
    <svg
      className="absolute inset-0 w-full h-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id="pourGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0" />
          <stop offset="40%" stopColor="var(--accent)" stopOpacity="0.45" />
          <stop offset="100%" stopColor="var(--accent-dark)" stopOpacity="0.6" />
        </linearGradient>
      </defs>
      {/* Colata principale */}
      <motion.path
        d="M 50,0 C 49,20 53,35 50,55 C 47,75 52,90 50,110"
        stroke="url(#pourGrad)"
        strokeWidth={6}
        strokeLinecap="round"
        fill="none"
        animate={{
          d: [
            'M 50,0 C 49,20 53,35 50,55 C 47,75 52,90 50,110',
            'M 50,0 C 51,18 47,38 50,55 C 53,72 48,92 50,110',
            'M 50,0 C 49,20 53,35 50,55 C 47,75 52,90 50,110',
          ],
        }}
        transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
        style={{ filter: 'blur(0.4px)' }}
      />
      {/* Pozza inferiore */}
      <motion.ellipse
        cx={50}
        cy={92}
        rx={18}
        ry={4}
        fill="var(--accent-dark)"
        opacity={0.4}
        animate={{ rx: [18, 21, 17, 18], opacity: [0.4, 0.5, 0.35, 0.4] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
      />
      {/* Goccia satellite */}
      <motion.circle
        cx={62}
        r={2.2}
        fill="var(--accent)"
        opacity={0.55}
        animate={{ cy: [-5, 110], opacity: [0, 0.7, 0.7, 0] }}
        transition={{
          duration: 4.5,
          repeat: Infinity,
          ease: 'easeIn',
          times: [0, 0.15, 0.85, 1],
          repeatDelay: 2,
        }}
      />
    </svg>
  )
}

/* ── 3. FLOCK — microfili di nylon a densità variabile ──────────── */
function FlockArt() {
  // Genera fibre con seed deterministico (no Math.random nel render)
  const fibers = Array.from({ length: 80 }, (_, i) => {
    const seed = (i * 9301 + 49297) % 233280
    const x = (seed / 233280) * 100
    const y = ((seed * 3) % 233280) / 233280 * 100
    const len = 4 + ((seed * 7) % 8)
    const angle = ((seed * 11) % 60) - 30
    const op = 0.15 + ((seed * 13) % 100) / 400
    return { x, y, len, angle, op, key: i }
  })

  return (
    <svg
      className="absolute inset-0 w-full h-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
    >
      {fibers.map((f) => (
        <motion.line
          key={f.key}
          x1={f.x}
          y1={f.y}
          x2={f.x + Math.cos((f.angle * Math.PI) / 180) * f.len}
          y2={f.y + Math.sin((f.angle * Math.PI) / 180) * f.len}
          stroke="var(--accent)"
          strokeWidth={0.25}
          strokeLinecap="round"
          opacity={f.op}
          animate={{ opacity: [f.op, f.op * 1.4, f.op * 0.7, f.op] }}
          transition={{
            duration: 5 + (f.key % 4),
            repeat: Infinity,
            ease: 'easeInOut',
            delay: (f.key % 7) * 0.3,
          }}
        />
      ))}
    </svg>
  )
}
