'use client'

import { useRef } from 'react'
import { motion, useInView, useReducedMotion } from 'framer-motion'

interface BentoGridProps {
  children: React.ReactNode
  className?: string
}

export function BentoGrid({ children, className = '' }: BentoGridProps) {
  return (
    <div className={`grid gap-4 ${className}`}>
      {children}
    </div>
  )
}

interface BentoItemProps {
  children: React.ReactNode
  className?: string
  span?: 'col-1' | 'col-2' | 'row-2' | 'col-2-row-2'
  delay?: number
}

export function BentoItem({
  children,
  className = '',
  span,
  delay = 0,
}: BentoItemProps) {
  const ref = useRef<HTMLDivElement>(null)
  const isInView = useInView(ref, { once: true, margin: '-10%' })
  const reduced = useReducedMotion()

  const spanClasses: Record<string, string> = {
    'col-1': '',
    'col-2': 'md:col-span-2',
    'row-2': 'md:row-span-2',
    'col-2-row-2': 'md:col-span-2 md:row-span-2',
  }

  if (reduced) {
    return (
      <div ref={ref} className={`${spanClasses[span ?? 'col-1']} ${className}`}>
        {children}
      </div>
    )
  }

  return (
    <motion.div
      ref={ref}
      className={`${spanClasses[span ?? 'col-1']} ${className}`}
      initial={{ opacity: 0, y: 32 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{
        duration: 0.65,
        delay,
        ease: [0.16, 1, 0.3, 1],
      }}
    >
      {children}
    </motion.div>
  )
}