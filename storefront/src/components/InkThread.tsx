'use client'

import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  useVelocity,
} from 'framer-motion'

/**
 * Goccia di inchiostro che attraversa l'intera pagina seguendo lo scroll.
 * - Posizione Y mappata su scrollYProgress (sempre visibile in viewport).
 * - Stretch fisico basato sulla velocità di scroll (deformazione liquida).
 * - Trail verticale che cresce dal top con gradient che sfuma.
 */
export function InkThread() {
  const reduced = useReducedMotion()
  if (reduced) return null
  return <InkThreadInner />
}

function InkThreadInner() {
  const { scrollYProgress } = useScroll()

  // Spring sullo scroll progress — toglie ogni jitter da scroll lineare
  const smooth = useSpring(scrollYProgress, {
    stiffness: 70,
    damping: 22,
    mass: 0.7,
  })

  // Velocity → deformazione goccia (stretch verticale, squeeze orizzontale)
  const velocity = useVelocity(smooth)
  const rawStretchY = useTransform(velocity, [-2.5, 0, 2.5], [1.55, 1, 1.55])
  const rawSquashX = useTransform(velocity, [-2.5, 0, 2.5], [0.72, 1, 0.72])
  const stretchY = useSpring(rawStretchY, { stiffness: 140, damping: 28 })
  const squashX = useSpring(rawSquashX, { stiffness: 140, damping: 28 })

  // Posizione verticale goccia: dal 12vh (alto) all'82vh (basso) man mano che scrolli
  const dropY = useTransform(smooth, [0, 1], ['12vh', '82vh'])

  // Traccia: cresce dall'alto fino alla posizione della goccia
  const trailHeight = useTransform(
    smooth,
    [0, 0.05, 0.95, 1],
    ['0vh', '14vh', '88vh', '88vh'],
  )
  const trailOpacity = useTransform(
    smooth,
    [0, 0.03, 0.92, 1],
    [0, 0.55, 0.45, 0],
  )

  // Goccia: fade-in dopo i primi pixel di scroll
  const dropOpacity = useTransform(smooth, [0, 0.015], [0, 1])

  return (
    <div
      className="fixed inset-0 pointer-events-none z-[5] hidden md:block"
      aria-hidden
    >
      {/* ── TRAIL ─────────────────────────────────────── */}
      <motion.div
        className="absolute"
        style={{
          right: 'calc(6vw - 0.5px)',
          top: 0,
          width: 1,
          height: trailHeight,
          opacity: trailOpacity,
          background:
            'linear-gradient(to bottom, transparent 0%, var(--accent-dark) 60%, var(--accent) 100%)',
          maskImage:
            'linear-gradient(to bottom, transparent 0%, black 35%, black 100%)',
          WebkitMaskImage:
            'linear-gradient(to bottom, transparent 0%, black 35%, black 100%)',
          filter: 'blur(0.3px)',
        }}
      />

      {/* ── DROP ──────────────────────────────────────── */}
      <motion.div
        className="absolute"
        style={{
          right: '6vw',
          top: dropY,
          width: 22,
          height: 22,
          marginRight: -11,
          opacity: dropOpacity,
          scaleX: squashX,
          scaleY: stretchY,
          transformOrigin: '50% 0%',
        }}
      >
        {/* Alone soft (glow esterno) */}
        <motion.div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              'radial-gradient(circle, var(--accent) 0%, transparent 65%)',
            transform: 'scale(2.6)',
            opacity: 0.22,
            filter: 'blur(8px)',
          }}
          animate={{ opacity: [0.18, 0.28, 0.18] }}
          transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
        />

        {/* Corpo goccia con gradient sferico */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              'radial-gradient(circle at 35% 28%, #d8b988 0%, var(--accent) 45%, var(--accent-dark) 100%)',
            boxShadow:
              '0 2px 14px rgba(200, 169, 126, 0.35), inset 0 -2px 4px rgba(0,0,0,0.25)',
          }}
        />

        {/* Highlight speculare */}
        <div
          className="absolute rounded-full"
          style={{
            top: '18%',
            left: '24%',
            width: '32%',
            height: '38%',
            background:
              'radial-gradient(circle, rgba(255,255,255,0.65) 0%, transparent 70%)',
            filter: 'blur(0.5px)',
          }}
        />
      </motion.div>
    </div>
  )
}
