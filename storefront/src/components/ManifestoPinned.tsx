'use client'

import { useRef } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { ManifestoVisual } from './ManifestoVisual'

interface VisualSources {
  unique?: string
  crafted?: string
  flock?: string
}

export function ManifestoPinned({ visuals }: { visuals?: VisualSources } = {}) {
  const t = useTranslations('home.manifesto')
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start start', 'end end'],
  })

  const l1Opacity = useTransform(
    scrollYProgress,
    [0, 0.05, 0.38, 0.48],
    [0, 1, 1, 0],
  )
  const l1Y = useTransform(scrollYProgress, [0, 0.48], [40, -50])

  const l2Opacity = useTransform(
    scrollYProgress,
    [0.44, 0.54, 0.7, 0.78],
    [0, 1, 1, 0],
  )
  const l2Y = useTransform(scrollYProgress, [0.44, 0.78], [60, -50])

  const l3Opacity = useTransform(
    scrollYProgress,
    [0.74, 0.82, 0.97, 1],
    [0, 1, 1, 1],
  )
  const l3Y = useTransform(scrollYProgress, [0.74, 1], [60, 0])

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
        <motion.div
          className="absolute inset-0"
          style={{ opacity: l1Opacity }}
        >
          <ManifestoVisual
            kind="unique"
            src={visuals?.unique}
            alt={visuals?.unique ? t('altUnique') : undefined}
          />
        </motion.div>
        <motion.div
          className="absolute inset-0"
          style={{ opacity: l2Opacity }}
        >
          <ManifestoVisual
            kind="crafted"
            src={visuals?.crafted}
            alt={visuals?.crafted ? t('altCrafted') : undefined}
          />
        </motion.div>
        <motion.div
          className="absolute inset-0"
          style={{ opacity: l3Opacity }}
        >
          <ManifestoVisual
            kind="flock"
            src={visuals?.flock}
            alt={visuals?.flock ? t('altFlock') : undefined}
          />
        </motion.div>

        <div className="max-w-7xl mx-auto w-full relative">
          <p
            className="text-xs uppercase tracking-[0.3em] mb-12 absolute top-[-25vh] left-0"
            style={{ color: 'var(--accent)' }}
          >
            {t('eyebrow')}
          </p>

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

          <motion.div
            className="absolute inset-0 flex items-center"
            style={{ opacity: l1Opacity, y: l1Y }}
          >
            <h2 className="font-display text-[clamp(40px,8vw,110px)] leading-none tracking-tight max-w-5xl">
              {t('layer1Headline1')}<br />
              <span style={{ color: 'var(--accent)' }}>{t('layer1Headline2')}</span>
            </h2>
          </motion.div>

          <motion.div
            className="absolute inset-0 flex items-center"
            style={{ opacity: l2Opacity, y: l2Y }}
          >
            <div className="max-w-3xl">
              <p className="font-display text-[clamp(32px,6vw,80px)] leading-[1.05] tracking-tight">
                {t('layer2Headline1')}
                <br />
                <span style={{ color: 'var(--accent)' }}>{t('layer2Headline2')}</span>
              </p>
              <p
                className="text-base md:text-lg leading-relaxed mt-8 max-w-xl"
                style={{ color: 'var(--muted-fg)' }}
              >
                {t('layer2Copy')}
              </p>
            </div>
          </motion.div>

          <motion.div
            className="absolute inset-0 flex items-center"
            style={{ opacity: l3Opacity, y: l3Y }}
          >
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-16 items-center w-full">
              <div className="max-w-2xl">
                <p className="font-display text-[clamp(28px,5vw,60px)] leading-[1.05] tracking-tight">
                  {t('layer3Headline1')}
                  <br />
                  {t('layer3Headline2')}
                </p>
                <p
                  className="text-base md:text-lg leading-relaxed mt-6"
                  style={{ color: 'var(--muted-fg)' }}
                >
                  {t('layer3Copy')}
                </p>
              </div>

              <div
                className="border-l pl-10 space-y-8 hidden md:block"
                style={{ borderColor: 'var(--border)' }}
              >
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: false, margin: '-30%' }}
                  transition={{ delay: 0, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                >
                  <p className="stat-number text-6xl mb-1" style={{ color: 'var(--accent)' }}>100%</p>
                  <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--muted-fg)' }}>{t('statsManual')}</p>
                </motion.div>
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: false, margin: '-30%' }}
                  transition={{ delay: 0.12, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                >
                  <p className="stat-number text-6xl mb-1" style={{ color: 'var(--accent)' }}>0</p>
                  <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--muted-fg)' }}>{t('statsIdentical')}</p>
                </motion.div>
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: false, margin: '-30%' }}
                  transition={{ delay: 0.24, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                >
                  <p className="stat-number text-6xl mb-1" style={{ color: 'var(--accent)' }}>IT</p>
                  <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--muted-fg)' }}>{t('statsLocation')}</p>
                </motion.div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}