// storefront/src/lib/motion.ts
// Costanti condivise per Framer Motion — speculari ai CSS var in globals.css

export const DURATION = {
  instant:   0.08,
  fast:      0.15,
  normal:    0.25,
  slow:      0.45,
  cinematic: 0.75,
} as const

export const EASE = {
  out:        [0, 0, 0.2, 1] as const,
  spring:     [0.16, 1, 0.3, 1] as const,
  emphasized: [0.4, 0, 0.6, 1] as const,
} as const

// Variants riutilizzabili per stagger di sezione
export const sectionVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.08,
    },
  },
} as const

export const fadeUpItem = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: DURATION.slow, ease: EASE.spring },
  },
} as const
