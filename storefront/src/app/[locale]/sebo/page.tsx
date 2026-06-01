import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Sebo — The Foolish Butcher',
    description: 'Il Pellaio. Custode delle pelli vive. Le sente respirare, sudare, guarire. Non dorme: le veglia.',
    openGraph: {
      title: 'Sebo — The Foolish Butcher',
      description: 'Il Pellaio. Custode delle pelli vive. Le sente respirare, sudare, guarire. Non dorme: le veglia.',
    },
  }
}

const CDN = process.env.NEXT_PUBLIC_FRANK_CDN ?? ''
const HERO_VIDEO = CDN ? `${CDN}/scene_02_clip.mp4` : ''
const HERO_POSTER = '/frank/frank-02.png'

const OBSESSIONS = [
  {
    id: 'flock',
    label: 'IL FLOCK',
    quote: 'Microfili di velluto tritato — rosso, blu, giallo — che cadono dove vogliono loro. Per questo nessuna pelle è uguale a un\'altra. Mai. Chi le vuole tutte identiche tatui pure sul linoleum.',
    img: '/frank/frank-01.png',
  },
  {
    id: 'discromie',
    label: 'LE DISCROMIE',
    quote: 'Non sono difetti. Sono la firma. La pelle vera è disomogenea, viva. Chi liscia tutto non ha mai guardato un avambraccio da vicino.',
    img: '/frank/frank-03.png',
  },
  {
    id: 'catalisi',
    label: 'LA CATALISI',
    quote: 'Dodici ore. La pelle nasce piano e i flock si posano dove devono. Chi ha fretta non merita la pelle.',
    img: '/frank/frank-lab.png',
  },
  {
    id: 'pelle-viva',
    label: 'LA PELLE VIVA',
    quote: 'Respira. Suda fuori l\'inchiostro che non merita. E guarisce, se la curi. Vuoi sapere se una pelle è viva? Falla guarire. Una vera si chiude. Un cadavere resta com\'è.',
    img: '/frank/frank-02.png',
  },
]

export default function SeboPage() {
  return (
    <div style={{ backgroundColor: '#0a0806', color: '#e8dcc8' }}>

      {/* ── HERO ── */}
      <section className="relative h-screen flex items-start overflow-hidden">
        {HERO_VIDEO ? (
          <video
            autoPlay
            muted
            loop
            playsInline
            poster={HERO_POSTER}
            className="absolute inset-0 w-full h-full object-cover"
            style={{ filter: 'brightness(0.45) sepia(0.3)' }}
          >
            <source src={HERO_VIDEO} type="video/mp4" />
          </video>
        ) : (
          <Image
            src={HERO_POSTER}
            alt="Sebo nel laboratorio"
            fill
            className="object-cover object-top"
            priority
            style={{ filter: 'brightness(0.4) sepia(0.3)' }}
          />
        )}

        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to bottom, #0a0806 0%, rgba(10,8,6,0.6) 40%, transparent 100%)' }}
        />

        <div className="relative z-10 max-w-7xl mx-auto px-8 md:px-16 pt-16 w-full">
          <p className="text-xs font-bold tracking-[0.4em] uppercase mb-4" style={{ color: '#c9a96e' }}>
            IL LABORATORIO · CHIERI (TO)
          </p>
          <h1
            className="font-display leading-none mb-4"
            style={{ fontSize: 'clamp(72px, 14vw, 180px)', color: '#e8dcc8' }}
          >
            SEBO
          </h1>
          <p className="text-base max-w-md" style={{ color: '#a89880' }}>
            Il Pellaio. Parla alle pelli. Le sente respirare.
          </p>
        </div>
      </section>

      {/* ── CHI È SEBO ── */}
      <section className="max-w-3xl mx-auto px-8 md:px-16 py-24">
        <p className="text-xs font-bold tracking-[0.35em] uppercase mb-10" style={{ color: '#c9a96e' }}>
          CHI È SEBO
        </p>

        <div className="space-y-6 text-base leading-relaxed" style={{ color: '#c8bfb0' }}>
          <p style={{ fontSize: '1.15rem', color: '#e8dcc8', fontWeight: 500 }}>
            Sebo non è un personaggio. È una conseguenza.
          </p>
          <p>
            Dal 2012, da quando il laboratorio produce le sue pelli, qualcuno doveva restare a vegliarle.
            Sebo è quel qualcuno — anche se "qualcuno" è generoso. Un incrocio tra un nano e qualcosa di
            più antico: il familiare che ogni laboratorio artigianale vero si porta dentro.
          </p>
          <p>
            Dodici anni di vapori del banco, di catalisi, di pelle respirata troppo a lungo. Non sa più
            dove finisce il laboratorio e dove comincia lui, e la testa gli gira sempre un po'. Lo chiamano
            Sebo perché lui È il sebo: l&apos;unica cosa che alla pelle sintetica in silicone mancava davvero.
            Lui le completa, loro gli danno un senso.
          </p>
          <p>
            Per Sebo le pelli sono vive. Respirano dai pori, sudano fuori l&apos;inchiostro che non meritano di
            tenere, e guariscono — se le curi. Le pelli economiche le chiama &ldquo;morte&rdquo;, &ldquo;bugiarde&rdquo;: non
            venderle qui è stata una sua battaglia. &ldquo;Un cadavere non guarisce&rdquo;, dice. &ldquo;La ferita gli resta
            aperta per sempre. La mia pelle si chiude.&rdquo;
          </p>
          <p className="italic" style={{ color: '#a89880', borderLeft: '2px solid #c9a96e', paddingLeft: '1.25rem' }}>
            Non si tatua, dice lui. Si venera. Pelle santa.
          </p>
        </div>
      </section>

      {/* ── LE SUE OSSESSIONI ── */}
      <section className="border-t py-24" style={{ borderColor: '#1e1812' }}>
        <div className="max-w-7xl mx-auto px-8 md:px-16">
          <p className="text-xs font-bold tracking-[0.35em] uppercase mb-12" style={{ color: '#c9a96e' }}>
            LE SUE OSSESSIONI
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {OBSESSIONS.map((o) => (
              <div key={o.id} className="group">
                <div className="relative aspect-[3/4] rounded overflow-hidden mb-5">
                  <Image
                    src={o.img}
                    alt={`Sebo — ${o.label.toLowerCase()}`}
                    fill
                    className="object-cover transition-transform duration-700 group-hover:scale-105"
                    style={{ filter: 'brightness(0.7) sepia(0.4)' }}
                  />
                  <div
                    className="absolute inset-0"
                    style={{ background: 'linear-gradient(to top, #0a0806 0%, transparent 60%)' }}
                  />
                  <div className="absolute bottom-4 left-4 right-4">
                    <p className="text-xs font-bold tracking-[0.3em] uppercase mb-1" style={{ color: '#c9a96e' }}>
                      {o.label}
                    </p>
                  </div>
                </div>
                <p className="text-sm italic leading-relaxed" style={{ color: '#a89880' }}>
                  &ldquo;{o.quote}&rdquo;
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── IL BANCO È APERTO ── */}
      <section className="border-t py-24" style={{ borderColor: '#1e1812' }}>
        <div className="max-w-7xl mx-auto px-8 md:px-16">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            {/* Image */}
            <div className="relative aspect-[4/5] rounded overflow-hidden order-2 md:order-1">
              <Image
                src="/frank/frank-lab.png"
                alt="Sebo nel laboratorio"
                fill
                className="object-cover object-top"
                style={{ filter: 'brightness(0.65) sepia(0.35)' }}
              />
            </div>

            {/* Text + CTAs */}
            <div className="order-1 md:order-2">
              <p className="text-xs font-bold tracking-[0.4em] uppercase mb-6" style={{ color: '#c9a96e' }}>
                IL BANCO È APERTO
              </p>
              <h2
                className="font-display leading-none mb-10"
                style={{ fontSize: 'clamp(40px, 6vw, 72px)', color: '#e8dcc8' }}
              >
                SEGUI O SCRIVI.
              </h2>

              {/* CTA 1 — Sebo's drops */}
              <div className="mb-8">
                <a
                  href="https://t.me/+f6VDb9iZdw5lMTE0"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-3 px-8 py-4 font-semibold text-sm tracking-widest uppercase transition-opacity hover:opacity-80 mb-3"
                  style={{ backgroundColor: '#c9a96e', color: '#0a0806' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248l-2.04 9.614c-.146.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.903.607z"/>
                  </svg>
                  Segui Sebo
                </a>
                <p className="text-xs" style={{ color: '#6b6055' }}>
                  Ogni dodici ore un pensiero dal banco. Non aspettarti gentilezza. Aspettati ossessione.
                </p>
              </div>

              {/* CTA 2 — unnamed support */}
              <div>
                <a
                  href="https://t.me/the_foolish_butcher_bot"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-3 px-8 py-4 font-semibold text-sm tracking-widest uppercase border transition-opacity hover:opacity-70 mb-3"
                  style={{ borderColor: '#c9a96e', color: '#c9a96e' }}
                >
                  Scrivi al laboratorio
                </a>
                <p className="text-xs" style={{ color: '#6b6055' }}>
                  Per ordini e spedizioni rispondiamo noi, dritti al punto.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Back link ── */}
      <div className="max-w-7xl mx-auto px-8 md:px-16 pb-16 border-t pt-8" style={{ borderColor: '#1e1812' }}>
        <Link href="/" className="text-xs tracking-widest uppercase hover:opacity-60 transition-opacity" style={{ color: '#6b6055' }}>
          ← Torna alla vetrina
        </Link>
      </div>

    </div>
  )
}
