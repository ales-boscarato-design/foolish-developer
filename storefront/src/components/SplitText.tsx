'use client'

import { motion, useReducedMotion, type Variants } from 'framer-motion'

interface Props {
  text: string
  className?: string
  style?: React.CSSProperties
  delay?: number
  stagger?: number
  duration?: number
  /** Se true: anima quando entra in viewport invece che al mount. */
  whileInView?: boolean
}

/**
 * Reveal lettera-per-lettera con stagger.
 * Default: anima al mount (per headline above-the-fold).
 * Con whileInView: anima al primo passaggio in viewport (per headline più in basso).
 */
export function SplitText({
  text,
  className,
  style,
  delay = 0,
  stagger = 0.022,
  duration = 0.42,
  whileInView = false,
}: Props) {
  const reduced = useReducedMotion()
  if (reduced) {
    return (
      <span className={className} style={style}>
        {text}
      </span>
    )
  }

  const chars = Array.from(text)

  const container: Variants = {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: stagger,
        delayChildren: delay,
      },
    },
  }

  // "Punch" — lettere arrivano da sopra con skew, snap secco, no soft fade
  const child: Variants = {
    hidden: { y: -28, skewX: -16, opacity: 0 },
    visible: {
      y: 0,
      skewX: 0,
      opacity: 1,
      transition: { duration, ease: [0.6, 0, 0.1, 1] },
    },
  }

  const motionProps = whileInView
    ? {
        initial: 'hidden' as const,
        whileInView: 'visible' as const,
        viewport: { once: true, margin: '-15%' },
      }
    : {
        initial: 'hidden' as const,
        animate: 'visible' as const,
      }

  return (
    <motion.span
      className={className}
      style={style}
      variants={container}
      {...motionProps}
    >
      {chars.map((c, i) => (
        <motion.span
          key={i}
          variants={child}
          style={{ display: 'inline-block', whiteSpace: 'pre' }}
        >
          {c === ' ' ? ' ' : c}
        </motion.span>
      ))}
    </motion.span>
  )
}
