'use client'

import { useRef } from 'react'
import { motion, useMotionValue, useSpring, useReducedMotion } from 'framer-motion'
import Link from 'next/link'

interface MagneticButtonProps {
  href: string
  children: React.ReactNode
  className?: string
  intensity?: number
  springStiffness?: number
  springDamping?: number
}

export function MagneticButton({
  href,
  children,
  className = '',
  intensity = 18,
  springStiffness = 150,
  springDamping = 15,
}: MagneticButtonProps) {
  const ref = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()

  const rawX = useMotionValue(0)
  const rawY = useMotionValue(0)

  const x = useSpring(rawX, { stiffness: springStiffness, damping: springDamping })
  const y = useSpring(rawY, { stiffness: springStiffness, damping: springDamping })

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (reduced || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    rawX.set((e.clientX - centerX) / rect.width * intensity)
    rawY.set((e.clientY - centerY) / rect.height * intensity)
  }

  function handleMouseLeave() {
    rawX.set(0)
    rawY.set(0)
  }

  if (reduced) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    )
  }

  return (
    <div ref={ref} style={{ display: 'inline-block' }}>
      <motion.div
        style={{ x, y }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className={className}
      >
        <Link
          href={href}
          style={{ display: 'block' }}
        >
          {children}
        </Link>
      </motion.div>
    </div>
  )
}
