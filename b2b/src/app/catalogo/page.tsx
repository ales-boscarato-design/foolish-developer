import { fetchResellerProducts } from '@/lib/cms'
import { ProductCard } from '@/components/ProductCard'
import { KitCard } from '@/components/KitCard'

export const dynamic = 'force-dynamic'

const PILLARS = [
  {
    icon: '✦',
    title: 'Produzione artigianale',
    body: 'Ogni foglio è lavorato a mano nel nostro laboratorio in piccoli lotti. Non produciamo in serie — e si vede.',
  },
  {
    icon: '◈',
    title: 'Ogni lotto, unico',
    body: 'Consistenza e colorazione variano naturalmente tra un lotto e l\'altro. I tuoi clienti tatueranno sempre su qualcosa di leggermente diverso.',
  },
  {
    icon: '⟳',
    title: 'Clienti fedeli garantiti',
    body: 'Un prodotto che cambia è un prodotto che non annoia. Chi tatua su Foolish torna per tatuare ancora su Foolish.',
  },
]

export default async function CatalogoPage() {
  const products = await fetchResellerProducts()

  return (
    <div>
      {/* ── HERO ── */}
      <section style={{ marginBottom: '4rem', paddingBottom: '3rem', borderBottom: '1px solid var(--border)' }}>
        <p style={{
          fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.18em',
          color: 'var(--accent)', marginBottom: '1rem',
        }}>
          Portale Rivenditori
        </p>
        <h1 style={{
          fontFamily: 'var(--font-cormorant)', fontStyle: 'italic', fontWeight: 600,
          fontSize: 'clamp(2rem, 5vw, 3.5rem)', lineHeight: 1.1,
          color: 'var(--foreground)', marginBottom: '1.5rem', maxWidth: '28rem',
        }}>
          Ogni foglio di pelle,<br />un&apos;opera irripetibile.
        </h1>
        <p style={{
          fontSize: '0.9rem', color: 'var(--muted-fg)', lineHeight: 1.75,
          maxWidth: '38rem', marginBottom: '2.5rem',
        }}>
          The Foolish Butcher produce pelli sintetiche per tatuaggio artigianalmente, in piccoli lotti curati uno ad uno.
          I tempi di consegna sono leggermente superiori alla produzione industriale — non per inefficienza, ma per scelta.
          Ogni lotto cambia per consistenza e tonalità: questo è il segreto che trasforma i tuoi clienti in <em style={{ color: 'var(--foreground)', fontStyle: 'italic' }}>habitué</em>.
        </p>

        {/* Pillar cards */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '1px',
          background: 'var(--border)',
          border: '1px solid var(--border)',
          borderRadius: '1rem',
          overflow: 'hidden',
        }}>
          {PILLARS.map((p) => (
            <div key={p.title} style={{ background: 'var(--card)', padding: '1.75rem 1.5rem' }}>
              <span aria-hidden="true" style={{ fontSize: '1.1rem', color: 'var(--accent)', display: 'block', marginBottom: '0.875rem' }}>
                {p.icon}
              </span>
              <p style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--foreground)', marginBottom: '0.5rem' }}>
                {p.title}
              </p>
              <p style={{ fontSize: '0.8rem', color: 'var(--muted-fg)', lineHeight: 1.65 }}>
                {p.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── CATALOGO ── */}
      {products.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '4rem 0', color: 'var(--muted-fg)' }}>
          <p>Nessun prodotto disponibile al momento.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4rem' }}>
          {(
            [
              { key: 'tattoo', label: 'Tattoo', description: 'Pelli sintetiche per pratica e formazione nel tatuaggio' },
              { key: 'pmu', label: 'PMU', description: 'Supporti per Permanent Make-up — sopracciglia, labbra, eyeliner' },
            ] as const
          ).map(({ key, label, description }) => {
            const section = products.filter(p => p.section === key)
            if (section.length === 0) return null
            return (
              <section key={key}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '1rem', marginBottom: '0.5rem' }}>
                  <h2 style={{
                    fontFamily: 'var(--font-cormorant)', fontStyle: 'italic', fontWeight: 600,
                    fontSize: '1.75rem', color: 'var(--foreground)',
                  }}>
                    {label}
                  </h2>
                  <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--accent)' }}>
                    {section.length} {section.length === 1 ? 'prodotto' : 'prodotti'}
                  </span>
                </div>
                <p style={{ fontSize: '0.8rem', color: 'var(--muted-fg)', marginBottom: '1.5rem' }}>
                  {description}
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '1.25rem' }}>
                  {section.map(p => <ProductCard key={p.id} product={p} />)}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {/* ── KIT RIVENDITORI ── */}
      {(() => {
        const kits = products.filter(p => p.section === 'kit')
        if (kits.length === 0) return null
        return (
          <section style={{ marginTop: '4rem', paddingTop: '3rem', borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '1rem', marginBottom: '0.5rem' }}>
              <h2 style={{
                fontFamily: 'var(--font-cormorant)', fontStyle: 'italic', fontWeight: 600,
                fontSize: '1.75rem', color: 'var(--foreground)',
              }}>
                Kit per iniziare
              </h2>
              <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--accent)' }}>
                Solo rivenditori
              </span>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--muted-fg)', marginBottom: '1.75rem' }}>
              Prova i nostri prodotti prima di ordinare in quantità — scontati e riservati ai partner.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.5rem' }}>
              {kits.map((kit, i) => <KitCard key={kit.id} product={kit} featured={i === 1} />)}
            </div>
          </section>
        )
      })()}

      {/* ── INFO RIVENDITORI ── */}
      <section style={{ marginTop: '5rem', paddingTop: '3.5rem', borderTop: '1px solid var(--border)' }}>
        <p style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.18em', color: 'var(--accent)', marginBottom: '2.5rem' }}>
          Informazioni per i rivenditori
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '2rem' }}>

          <div>
            <h3 style={{ fontFamily: 'var(--font-cormorant)', fontStyle: 'italic', fontWeight: 600, fontSize: '1.25rem', color: 'var(--foreground)', marginBottom: '1rem' }}>
              Come lavoriamo
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--muted-fg)', lineHeight: 1.8 }}>
              Non lavoriamo a magazzino. Ogni ordine viene preparato nel momento in cui arriva: la pelle viene realizzata giornalmente, e giorno per giorno calibriamo consistenza e colore. Così ricevi sempre un prodotto fresco, mai fermo a scaffale per mesi.
            </p>
            <p style={{ fontSize: '0.85rem', color: 'var(--muted-fg)', lineHeight: 1.8, marginTop: '0.875rem' }}>
              Proprio perché ogni pelle nasce su ordinazione e viene controllata una a una, la spedizione richiede in media circa{' '}
              <span style={{ color: 'var(--foreground)', fontWeight: 500 }}>10 giorni lavorativi</span>: è il tempo che ci serve per realizzarla a regola d&apos;arte.
            </p>
            <p style={{ fontSize: '0.85rem', color: 'var(--muted-fg)', lineHeight: 1.8, marginTop: '0.875rem' }}>
              Ogni pelle rispetta i nostri standard di produzione più alti e viene controllata per essere esente da difetti. Lavorando a mano, però, può capitare che qualcosa ci sfugga: in quel caso la sostituzione è immediata e garantita, senza discussioni.
            </p>
          </div>

          <div>
            <h3 style={{ fontFamily: 'var(--font-cormorant)', fontStyle: 'italic', fontWeight: 600, fontSize: '1.25rem', color: 'var(--foreground)', marginBottom: '1rem' }}>
              Cosa possiamo fare per il rivenditore di fiducia
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--muted-fg)', lineHeight: 1.8 }}>
              Scegliamo i nostri rivenditori con cura, in base al territorio e alla continuità dei riordini. Producendo in modo artigianale, non puntiamo a coprire ogni angolo del mercato: preferiamo pochi partner motivati, che condividano la nostra idea di qualità e capiscano cosa una buona pelle sintetica deve davvero offrire a chi pratica.
            </p>
          </div>

          <div>
            <h3 style={{ fontFamily: 'var(--font-cormorant)', fontStyle: 'italic', fontWeight: 600, fontSize: '1.25rem', color: 'var(--foreground)', marginBottom: '1rem' }}>
              Il packaging: a marchio Foolish o su misura
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--muted-fg)', lineHeight: 1.8 }}>
              I nostri prodotti arrivano con il packaging Foolish. Per molti rivenditori è un valore aggiunto: un marchio riconoscibile aiuta a vendere e dà credibilità al prodotto sul banco.
            </p>
            <p style={{ fontSize: '0.85rem', color: 'var(--muted-fg)', lineHeight: 1.8, marginTop: '0.875rem' }}>
              Se invece preferisci proteggere il rapporto diretto con i tuoi clienti finali, possiamo lavorare in white label o personalizzare il packaging sulle tue esigenze. Decidi tu come presentarti — ne parliamo insieme e troviamo la formula giusta.
            </p>
          </div>

        </div>
      </section>

    </div>
  )
}
