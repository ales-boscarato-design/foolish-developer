'use client'

import { useRef } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'
import { ManifestoVisual } from './ManifestoVisual'

interface VisualSources {
  unique?: string
  crafted?: string
  flock?: string
}

/**
 * Sezione manifesto con scroll-driven storytelling.
 * Container alto 300vh, contenuto sticky che pin al centro.
 * Lo scroll dentro la sezione fa transizionare 3 layer:
 *   0.00 - 0.40  →  Headline "OGNI PELLE È UN PEZZO UNICO."
 *   0.30 - 0.70  →  "Foolish non compra la pelle. La fa."
 *   0.60 - 1.00  →  Copy flock + stats animati
 */
export function ManifestoPinned({ visuals }: { visuals?: VisualSources } = {}) {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start start', 'end end'],
  })

  // Layer 1 — headline (più respiro, fade out più tardo)
  const l1Opacity = useTransform(
    scrollYProgress,
    [0, 0.05, 0.38, 0.48],
    [0, 1, 1, 0],
  )
  const l1Y = useTransform(scrollYProgress, [0, 0.48], [40, -50])

  // Layer 2 — "non compra, la fa"
  const l2Opacity = useTransform(
    scrollYProgress,
    [0.44, 0.54, 0.7, 0.78],
    [0, 1, 1, 0],
  )
  const l2Y = useTransform(scrollYProgress, [0.44, 0.78], [60, -50])

  // Layer 3 — flock + stats
  const l3Opacity = useTransform(
    scrollYProgress,
    [0.74, 0.82, 0.97, 1],
    [0, 1, 1, 1],
  )
  const l3Y = useTransform(scrollYProgress, [0.74, 1], [60, 0])

  // Progress bar laterale
  const progressScale = useTransform(scrollYProgress, [0, 1], [0, 1])

  return (
    <section
      ref={ref}
      className="border-b relative"
      style={{
        borderColor: 'var(--border)',
        backgroundColor: 'var(--muted)',
        height: '400vh',
      }}
    >
      <div className="sticky top-0 h-screen flex items-center px-8 md:px-16 overflow-hidden">
        {/* ── VISUAL LAYERS — uno per ogni narrative step ── */}
        <motion.div
          className="absolute inset-0"
          style={{ opacity: l1Opacity }}
        >
          <ManifestoVisual
            kind="unique"
            src={visuals?.unique}
            alt={visuals?.unique ? 'Foglio di pelle sintetica unico' : undefined}
          />
        </motion.div>
        <motion.div
          className="absolute inset-0"
          style={{ opacity: l2Opacity }}
        >
          <ManifestoVisual
            kind="crafted"
            src={visuals?.crafted}
            alt={visuals?.crafted ? 'Produzione manuale del silicone' : undefined}
          />
        </motion.div>
        <motion.div
          className="absolute inset-0"
          style={{ opacity: l3Opacity }}
        >
          <ManifestoVisual
            kind="flock"
            src={visuals?.flock}
            alt={visuals?.flock ? 'Microfili di nylon flock' : undefined}
          />
        </motion.div>

        <div className="max-w-7xl mx-auto w-full relative">
          {/* Eyebrow fisso */}
          <p
            className="text-xs uppercase tracking-[0.3em] mb-12 absolute top-[-25vh] left-0"
            style={{ color: 'var(--accent)' }}
          >
            Il processo
          </p>

          {/* ── Progress bar verticale destra ── */}
          <div
            className="absolute right-0 top-[-15vh] hidden md:block"
            style={{ height: '30vh', width: 1 }}
          >
            <div
              className="absolute inset-0"
              style={{ backgroundColor: 'var(--border)' }}
            />
            <motion.div
              className="absolute inset-0 origin-top"
              style={{
                scaleY: progressScale,
                backgroundColor: 'var(--accent)',
              }}
            />
          </div>

          {/* ── LAYER 1: Headline ── */}
          <motion.div
            className="absolute inset-0 flex items-center"
            style={{ opacity: l1Opacity, y: l1Y }}
          >
            <h2 className="font-display text-[clamp(40px,8vw,110px)] leading-none tracking-tight max-w-5xl">
              OGNI PELLE È<br />
              <span style={{ color: 'var(--accent)' }}>UN PEZZO UNICO.</span>
            </h2>
          </motion.div>

          {/* ── LAYER 2: Foolish la fa ── */}
          <motion.div
            className="absolute inset-0 flex items-center"
            style={{ opacity: l2Opacity, y: l2Y }}
          >
            <div className="max-w-3xl">
              <p className="font-display text-[clamp(32px,6vw,80px)] leading-[1.05] tracking-tight">
                Foolish non compra la pelle.
                <br />
                <span style={{ color: 'var(--accent)' }}>La fa.</span>
              </p>
              <p
                className="text-base md:text-lg leading-relaxed mt-8 max-w-xl"
                style={{ color: 'var(--muted-fg)' }}
              >
                Dall&apos;inizio. A mano. Da un silicone puro al platino, trasformato
                in superficie grazie a un processo proprietario che non troverai
                altrove.
              </p>
            </div>
          </motion.div>

          {/* ── LAYER 3: Flock + stats ── */}
          <motion.div
            className="absolute inset-0 flex items-center"
            style={{ opacity: l3Opacity, y: l3Y }}
          >
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-16 items-center w-full">
              <div className="max-w-2xl">
                <p className="font-display text-[clamp(28px,5vw,60px)] leading-[1.05] tracking-tight">
                  Microfili di nylon,
                  <br />
                  sospesi nel silicone.
                </p>
                <p
                  className="text-base md:text-lg leading-relaxed mt-6"
                  style={{ color: 'var(--muted-fg)' }}
                >
                  Si fissano a profondità diverse durante la catalisi. Nuance
                  inaspettate, discromie reali, texture che cambiano a ogni
                  pezzo. Il colore non è stampato.{' '}
                  <span style={{ color: 'var(--foreground)' }}>È vivo.</span>
                </p>
              </div>

              <div
                className="border-l pl-10 space-y-8 hidden md:block"
                style={{ borderColor: 'var(--border)' }}
              >
                {[
                  { n: '100%', l: 'Produzione manuale' },
                  { n: '0', l: 'Pelli identiche' },
                  { n: 'IT', l: 'Chieri, Torino' },
                ].map((s, i) => (
                  <motion.div
                    key={s.n}
                    initial={{ opacity: 0, x: 20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: false, margin: '-30%' }}
                    transition={{
                      delay: i * 0.12,
                      duration: 0.8,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                  >
                    <p
                      className="stat-number text-6xl mb-1"
                      style={{ color: 'var(--accent)' }}
                    >
                      {s.n}
                    </p>
                    <p
                      className="text-xs uppercase tracking-wide"
                      style={{ color: 'var(--muted-fg)' }}
                    >
                      {s.l}
                    </p>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
