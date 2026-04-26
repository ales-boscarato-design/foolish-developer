'use client'

import { useRef } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'

const BLOOD = '#720000'
const BLOOD_MID = '#8a0000'

const BLOB_A = [
  'M 0,50 C 0,22 22,0 50,0 C 78,0 100,22 100,50 C 100,78 78,100 50,100 C 22,100 0,78 0,50 Z',
  'M 0,48 C 2,20 24,-2 52,1 C 80,4 102,25 100,52 C 98,80 76,102 48,100 C 20,98 -2,76 0,48 Z',
  'M 2,52 C 0,24 22,-1 50,1 C 78,3 101,26 99,54 C 97,82 74,101 46,99 C 18,97 4,80 2,52 Z',
  'M 0,50 C 0,22 22,0 50,0 C 78,0 100,22 100,50 C 100,78 78,100 50,100 C 22,100 0,78 0,50 Z',
]

const BLOB_B = [
  'M 0,30 C 0,13 13,0 30,0 C 47,0 60,13 60,30 C 60,47 47,60 30,60 C 13,60 0,47 0,30 Z',
  'M 1,31 C 0,14 14,-1 31,1 C 48,3 61,15 59,32 C 57,49 44,61 27,59 C 10,57 2,48 1,31 Z',
  'M 0,29 C 1,12 14,-1 31,1 C 48,3 60,16 59,33 C 58,50 45,61 28,60 C 11,59 -1,46 0,29 Z',
  'M 0,30 C 0,13 13,0 30,0 C 47,0 60,13 60,30 C 60,47 47,60 30,60 C 13,60 0,47 0,30 Z',
]

export function HeroInk() {
  const ref = useRef<HTMLDivElement>(null)

  const { scrollY } = useScroll()

  /* Blob grande: sale lentamente mentre si scrolla */
  const yBlob = useTransform(scrollY, [0, 600], [0, -90])
  /* Blob piccolo: sale più veloce (parallax diverso) */
  const ySmall = useTransform(scrollY, [0, 600], [0, -140])
  /* Traccia verticale: si allunga con lo scroll */
  const trailH = useTransform(scrollY, [0, 400], [0, 120])
  const trailOpacity = useTransform(scrollY, [0, 100, 400, 500], [0, 0.6, 0.9, 0])

  return (
    <div
      ref={ref}
      className="absolute inset-0 pointer-events-none overflow-hidden"
      aria-hidden
    >
      {/* ── BLOB PRINCIPALE ─────────────────────────── */}
      <motion.div
        className="absolute"
        style={{ top: '14%', right: '10%', y: yBlob }}
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1.8, ease: [0.16, 1, 0.3, 1] }}
      >
        <svg width="110" height="110" viewBox="0 0 100 100" overflow="visible">
          {/* Glow */}
          <motion.path
            d={BLOB_A[0]}
            fill={BLOOD}
            opacity={0.15}
            transform="scale(1.4) translate(-7,-7)"
            animate={{ d: BLOB_A }}
            transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut', times: [0, 0.33, 0.66, 1] }}
          />
          {/* Corpo */}
          <motion.path
            d={BLOB_A[0]}
            fill={BLOOD}
            animate={{ d: BLOB_A }}
            transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut', times: [0, 0.33, 0.66, 1] }}
          />
          {/* Riflesso */}
          <motion.ellipse
            cx={36} cy={32} rx={9} ry={13}
            fill="white"
            opacity={0.06}
            animate={{ rx: [9, 10, 8, 9], ry: [13, 12, 14, 13] }}
            transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
          />
        </svg>
      </motion.div>

      {/* ── TRACCIA VERTICALE — cresce con lo scroll ── */}
      <motion.div
        className="absolute"
        style={{
          top: '14%',
          right: 'calc(10% + 52px)',
          width: 4,
          borderRadius: 2,
          backgroundColor: BLOOD_MID,
          height: trailH,
          opacity: trailOpacity,
          transformOrigin: 'top center',
        }}
      />

      {/* ── BLOB SATELLITE ──────────────────────────── */}
      <motion.div
        className="absolute"
        style={{ bottom: '22%', right: '24%', y: ySmall }}
        initial={{ opacity: 0, scale: 0 }}
        animate={{ opacity: 0.7, scale: 1 }}
        transition={{ duration: 1.6, delay: 0.9, ease: [0.16, 1, 0.3, 1] }}
      >
        <svg width="52" height="52" viewBox="0 0 60 60" overflow="visible">
          <motion.path
            d={BLOB_B[0]}
            fill={BLOOD}
            animate={{ d: BLOB_B }}
            transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut', repeatType: 'mirror', delay: 1.5 }}
          />
        </svg>
      </motion.div>

      {/* ── PUNTINO TERZIARIO ────────────────────────── */}
      <motion.div
        className="absolute"
        style={{ top: '58%', right: '8%' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.3 }}
        transition={{ duration: 2, delay: 1.4 }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16">
          <motion.circle
            cx={8} cy={8} r={7}
            fill={BLOOD}
            animate={{ r: [7, 8, 6, 7] }}
            transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut', repeatType: 'mirror', delay: 2 }}
          />
        </svg>
      </motion.div>
    </div>
  )
}
