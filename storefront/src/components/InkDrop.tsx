'use client'

import { motion } from 'framer-motion'

const BLOOD = '#720000'
const BLOOD_LIGHT = '#9a0000'

/* Morfologia blob — stesse coordinate, forme diverse */
const BLOB_SHAPES = [
  'M 60,8 C 85,8 105,28 108,52 C 112,80 95,105 70,118 C 60,123 50,123 40,118 C 15,105 -2,80 2,52 C 6,28 25,8 60,8 Z',
  'M 60,5 C 87,5 110,25 112,50 C 114,78 96,107 68,119 C 58,124 48,123 38,118 C 12,106 -4,78 2,50 C 8,24 30,5 60,5 Z',
  'M 60,10 C 83,10 102,32 105,56 C 108,82 92,104 66,116 C 56,121 48,122 40,117 C 16,106 2,82 4,56 C 6,30 28,10 60,10 Z',
  'M 60,7 C 88,7 110,26 112,51 C 115,79 97,106 70,119 C 60,124 49,124 38,118 C 12,106 -3,79 2,51 C 6,25 28,7 60,7 Z',
]

/* Goccia satellite (piccola) */
const SMALL_BLOB = [
  'M 16,3 C 24,3 30,10 30,18 C 30,27 24,33 16,35 C 8,33 2,27 2,18 C 2,10 8,3 16,3 Z',
  'M 16,2 C 25,2 31,9 31,17 C 31,26 25,34 16,36 C 7,34 1,26 1,17 C 1,9 7,2 16,2 Z',
  'M 16,4 C 24,4 29,11 29,19 C 29,27 23,33 16,35 C 9,33 3,27 3,19 C 3,11 8,4 16,4 Z',
]

export function InkDrop() {
  return (
    <div
      className="absolute inset-0 pointer-events-none overflow-hidden"
      aria-hidden
    >
      {/* ── BLOB PRINCIPALE ───────────────────────── */}
      <motion.div
        className="absolute"
        style={{ top: '12%', right: '12%' }}
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 2, ease: [0.16, 1, 0.3, 1] }}
      >
        <svg width="120" height="140" viewBox="0 0 120 130" overflow="visible">
          {/* Alone — glow interno */}
          <motion.path
            d={BLOB_SHAPES[0]}
            fill={BLOOD}
            opacity={0.18}
            transform="scale(1.35) translate(-13, -8)"
            animate={{ d: BLOB_SHAPES }}
            transition={{
              duration: 10,
              repeat: Infinity,
              ease: 'easeInOut',
              times: [0, 0.3, 0.6, 1],
            }}
          />

          {/* Corpo principale */}
          <motion.path
            d={BLOB_SHAPES[0]}
            fill={BLOOD}
            animate={{ d: BLOB_SHAPES }}
            transition={{
              duration: 10,
              repeat: Infinity,
              ease: 'easeInOut',
              times: [0, 0.3, 0.6, 1],
            }}
          />

          {/* Riflesso interno — luce su inchiostro */}
          <motion.ellipse
            cx={42}
            cy={38}
            rx={10}
            ry={14}
            fill="white"
            opacity={0.07}
            animate={{
              rx: [10, 11, 9, 10],
              ry: [14, 13, 15, 14],
              opacity: [0.07, 0.09, 0.06, 0.07],
            }}
            transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
          />

          {/* ── DRIP — fuoriesce dal basso del blob ── */}
          {/* Stem */}
          <motion.rect
            x={57}
            y={118}
            width={5}
            rx={2.5}
            fill={BLOOD}
            animate={{
              height: [0, 0, 0, 45, 55, 55, 0],
              opacity: [0, 0, 0.8, 1, 1, 0.4, 0],
            }}
            transition={{
              duration: 5,
              repeat: Infinity,
              repeatDelay: 4,
              ease: 'easeIn',
              times: [0, 0.15, 0.3, 0.6, 0.75, 0.9, 1],
            }}
          />

          {/* Goccia terminale */}
          <motion.ellipse
            cx={59.5}
            fill={BLOOD}
            animate={{
              cy: [172, 172, 172, 180, 192, 210],
              rx: [0, 0, 4, 5, 6, 0],
              ry: [0, 0, 5, 7, 4, 0],
              opacity: [0, 0, 1, 1, 0.6, 0],
            }}
            transition={{
              duration: 5,
              repeat: Infinity,
              repeatDelay: 4,
              ease: [0.4, 0, 1, 1],
              times: [0, 0.3, 0.55, 0.7, 0.85, 1],
            }}
          />

          {/* Splash — 4 raggi che esplodono al touch */}
          {[0, 72, 144, 216, 288].map((angle, i) => (
            <motion.line
              key={i}
              x1={59.5}
              y1={192}
              x2={59.5 + Math.cos((angle * Math.PI) / 180) * 14}
              y2={192 + Math.sin((angle * Math.PI) / 180) * 7}
              stroke={BLOOD_LIGHT}
              strokeWidth={1.5}
              strokeLinecap="round"
              animate={{
                opacity: [0, 0, 0, 0, 1, 0],
                strokeWidth: [1.5, 1.5, 1.5, 1.5, 1.5, 0.5],
              }}
              transition={{
                duration: 5,
                repeat: Infinity,
                repeatDelay: 4,
                times: [0, 0.3, 0.6, 0.78, 0.88, 1],
                delay: i * 0.04,
              }}
            />
          ))}
        </svg>
      </motion.div>

      {/* ── BLOB SATELLITE — piccolo, in basso ──── */}
      <motion.div
        className="absolute"
        style={{ bottom: '18%', right: '22%' }}
        initial={{ opacity: 0, scale: 0 }}
        animate={{ opacity: 0.75, scale: 1 }}
        transition={{ duration: 1.8, delay: 0.8, ease: [0.16, 1, 0.3, 1] }}
      >
        <svg width="32" height="40" viewBox="0 0 32 40" overflow="visible">
          <motion.path
            d={SMALL_BLOB[0]}
            fill={BLOOD}
            animate={{ d: SMALL_BLOB }}
            transition={{
              duration: 7,
              repeat: Infinity,
              ease: 'easeInOut',
              repeatType: 'mirror',
              delay: 2,
            }}
          />
        </svg>
      </motion.div>

      {/* ── TERZO DROP — angolo opposto, quasi invisibile ── */}
      <motion.div
        className="absolute"
        style={{ top: '55%', right: '6%' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.35 }}
        transition={{ duration: 2, delay: 1.2 }}
      >
        <svg width="18" height="22" viewBox="0 0 18 22">
          <motion.ellipse
            cx={9} cy={11} rx={8} ry={10}
            fill={BLOOD}
            animate={{
              ry: [10, 11, 9, 10],
              rx: [8, 7, 9, 8],
            }}
            transition={{
              duration: 6,
              repeat: Infinity,
              ease: 'easeInOut',
              repeatType: 'mirror',
              delay: 3,
            }}
          />
        </svg>
      </motion.div>
    </div>
  )
}
