'use client'
import { useState } from 'react'

interface ProfileFormProps {
  level: string | null
  styles: string[]
  locale: string
  notifyOrders: boolean
  notifyNewBatches: boolean
  notifyOffers: boolean
  pushPublicKey: string
}

const LEVELS = ['tatuatore','pmu','studente','professionista']
const STYLES = ['linework_fine','blackwork','realism','old_school','watercolor','tribal','geometric']
const STYLE_LABELS: Record<string, string> = {
  linework_fine: 'Linework fine', blackwork: 'Blackwork', realism: 'Realism',
  old_school: 'Old school', watercolor: 'Watercolor', tribal: 'Tribal', geometric: 'Geometric',
}
const LOCALES = [
  { code: 'it', label: '🇮🇹 Italiano' },
  { code: 'en', label: '🇬🇧 English' },
  { code: 'de', label: '🇩🇪 Deutsch' },
  { code: 'fr', label: '🇫🇷 Français' },
  { code: 'es', label: '🇪🇸 Español' },
]

export function ProfileForm({ level, styles, locale, notifyOrders, notifyNewBatches, notifyOffers, pushPublicKey }: ProfileFormProps) {
  const [form, setForm] = useState({ level, styles, locale, notifyOrders, notifyNewBatches, notifyOffers })
  const [saved, setSaved] = useState(false)
  const [pushStatus, setPushStatus] = useState<'unknown'|'active'|'denied'>('unknown')

  async function save(updates: Partial<typeof form>) {
    const next = { ...form, ...updates }
    setForm(next)
    await fetch('/api/account/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        level: next.level,
        styles: next.styles,
        locale: next.locale,
        notify_orders: next.notifyOrders,
        notify_new_batches: next.notifyNewBatches,
        notify_offers: next.notifyOffers,
      }),
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function enablePush() {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') { setPushStatus('denied'); return }

    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: pushPublicKey,
    })
    await fetch('/api/account/push-subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub.toJSON()),
    })
    setPushStatus('active')
  }

  async function logout() {
    await fetch('/api/account/logout', { method: 'POST' })
    window.location.href = '/account/login'
  }

  function toggleStyle(style: string) {
    const next = form.styles.includes(style)
      ? form.styles.filter((s) => s !== style)
      : [...form.styles, style]
    save({ styles: next })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {saved && <div style={{ background: '#5a7a5a22', color: '#5a7a5a', fontSize: '11px', padding: '6px 10px', borderRadius: '4px' }}>Salvato ✓</div>}

      {/* Livello */}
      <div>
        <div style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>Chi sei</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {LEVELS.map((l) => (
            <button key={l} onClick={() => save({ level: l })}
              style={{ background: form.level === l ? '#c9a96e' : '#1a1a1a', color: form.level === l ? '#000' : '#555', fontSize: '11px', padding: '5px 12px', borderRadius: '16px', border: '1px solid', borderColor: form.level === l ? '#c9a96e' : '#333', cursor: 'pointer', fontWeight: form.level === l ? 600 : 400 }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Stile */}
      <div>
        <div style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>Stile preferito</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {STYLES.map((s) => (
            <button key={s} onClick={() => toggleStyle(s)}
              style={{ background: form.styles.includes(s) ? '#c9a96e' : '#1a1a1a', color: form.styles.includes(s) ? '#000' : '#555', fontSize: '11px', padding: '5px 12px', borderRadius: '16px', border: '1px solid', borderColor: form.styles.includes(s) ? '#c9a96e' : '#333', cursor: 'pointer', fontWeight: form.styles.includes(s) ? 600 : 400 }}>
              {STYLE_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {/* Lingua */}
      <div>
        <div style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>Lingua comunicazioni</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {LOCALES.map(({ code, label }) => (
            <button key={code} onClick={() => save({ locale: code })}
              style={{ background: form.locale === code ? '#c9a96e' : '#1a1a1a', color: form.locale === code ? '#000' : '#555', fontSize: '11px', padding: '5px 12px', borderRadius: '16px', border: '1px solid', borderColor: form.locale === code ? '#c9a96e' : '#333', cursor: 'pointer', fontWeight: form.locale === code ? 600 : 400 }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Notifiche */}
      <div style={{ background: '#111', borderRadius: '8px', padding: '14px' }}>
        <div style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>Notifiche</div>
        {([
          { key: 'notifyOrders' as const, label: 'Aggiornamenti ordine', sub: 'Produzione, spedizione, consegna' },
          { key: 'notifyNewBatches' as const, label: 'Nuovi lotti', sub: 'Quando arriva flock che ti piace' },
          { key: 'notifyOffers' as const, label: 'Offerte personalizzate', sub: 'Max 1 a settimana' },
        ]).map(({ key, label, sub }) => (
          <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <div>
              <div style={{ fontSize: '12px', color: '#fff' }}>{label}</div>
              <div style={{ fontSize: '10px', color: '#555' }}>{sub}</div>
            </div>
            <div
              onClick={() => save({ [key]: !form[key] })}
              style={{ width: '36px', height: '20px', background: form[key] ? '#c9a96e' : '#333', borderRadius: '10px', position: 'relative', cursor: 'pointer' }}
            >
              <div style={{ width: '16px', height: '16px', background: form[key] ? '#000' : '#666', borderRadius: '50%', position: 'absolute', top: '2px', ...(form[key] ? { right: '2px' } : { left: '2px' }), transition: 'all 0.15s' }} />
            </div>
          </div>
        ))}

        <div style={{ borderTop: '1px solid #1a1a1a', paddingTop: '10px', marginTop: '4px' }}>
          {pushStatus === 'active' ? (
            <div style={{ fontSize: '11px', color: '#5a7a5a' }}>✓ Push notifiche attive</div>
          ) : pushStatus === 'denied' ? (
            <div style={{ fontSize: '11px', color: '#888' }}>Push bloccate dal browser. Abilita dalle impostazioni.</div>
          ) : (
            <button onClick={enablePush}
              style={{ background: '#1a1a1a', color: '#c9a96e', border: '1px solid #c9a96e44', fontSize: '11px', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer' }}>
              Attiva notifiche push →
            </button>
          )}
        </div>
      </div>

      {/* Logout */}
      <div style={{ textAlign: 'center', paddingTop: '8px' }}>
        <button onClick={logout} style={{ background: 'transparent', border: 'none', color: '#444', fontSize: '11px', cursor: 'pointer' }}>
          Esci dall&apos;account
        </button>
      </div>
    </div>
  )
}
