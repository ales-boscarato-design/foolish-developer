'use client'
import { useState } from 'react'

interface ProfileLabels {
  whoAreYou: string; preferredStyle: string; commLanguage: string; notifications: string
  notifyOrdersLabel: string; notifyOrdersSub: string; notifyBatchesLabel: string; notifyBatchesSub: string
  notifyOffersLabel: string; notifyOffersSub: string; pushActive: string; pushDenied: string
  pushEnable: string; pushUnsupported: string; logout: string; savedLabel: string
  levelLabels: Record<string, string>
}

interface ProfileFormProps {
  level: string | null; styles: string[]; locale: string
  notifyOrders: boolean; notifyNewBatches: boolean; notifyOffers: boolean
  pushPublicKey: string; labels: ProfileLabels
}

const LEVELS = ['tatuatore','pmu','studente','professionista']
const STYLES = ['linework_fine','blackwork','realism','old_school','watercolor','tribal','geometric']
const STYLE_LABELS: Record<string, string> = {
  linework_fine: 'Linework fine', blackwork: 'Blackwork', realism: 'Realism',
  old_school: 'Old school', watercolor: 'Watercolor', tribal: 'Tribal', geometric: 'Geometric',
}
const LOCALES = [
  { code: 'it', label: '🇮🇹 IT' },
  { code: 'en', label: '🇬🇧 EN' },
  { code: 'de', label: '🇩🇪 DE' },
  { code: 'fr', label: '🇫🇷 FR' },
  { code: 'es', label: '🇪🇸 ES' },
]


export function ProfileForm({ level, styles, locale, notifyOrders, notifyNewBatches, notifyOffers, pushPublicKey, labels }: ProfileFormProps) {
  const [form, setForm] = useState({ level, styles, locale, notifyOrders, notifyNewBatches, notifyOffers })
  const [saved, setSaved] = useState(false)
  const [pushStatus, setPushStatus] = useState<'unknown'|'active'|'denied'|'loading'|'unsupported'|'error'>('unknown')
  const [pushError, setPushError] = useState<string>('')

  async function save(updates: Partial<typeof form>) {
    const prevLocale = form.locale
    const next = { ...form, ...updates }
    setForm(next)
    await fetch('/api/account/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        level: next.level, styles: next.styles, locale: next.locale,
        notify_orders: next.notifyOrders, notify_new_batches: next.notifyNewBatches, notify_offers: next.notifyOffers,
      }),
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    if (updates.locale && updates.locale !== prevLocale) {
      document.cookie = `foolish_locale=${updates.locale}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`
      window.location.reload()
    }
  }

  async function enablePush() {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      setPushStatus('unsupported')
      return
    }
    setPushStatus('loading')
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') { setPushStatus('denied'); return }
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: pushPublicKey,
      })
      const res = await fetch('/api/account/push-subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      })
      if (!res.ok) throw new Error(`server ${res.status}`)
      setPushStatus('active')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setPushError(msg)
      setPushStatus('error')
    }
  }

  async function logout() {
    await fetch('/api/account/logout', { method: 'POST' })
    window.location.href = '/account/login'
  }

  function toggleStyle(style: string) {
    const next = form.styles.includes(style) ? form.styles.filter((s) => s !== style) : [...form.styles, style]
    save({ styles: next })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {saved && <div style={{ background: '#5a7a5a22', color: '#5a7a5a', fontSize: '11px', padding: '6px 10px', borderRadius: '4px' }}>{labels.savedLabel}</div>}

      <div>
        <div style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>{labels.whoAreYou}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {LEVELS.map((l) => (
            <button key={l} onClick={() => save({ level: l })}
              style={{ background: form.level === l ? '#c9a96e' : '#1a1a1a', color: form.level === l ? '#000' : '#555', fontSize: '11px', padding: '5px 12px', borderRadius: '16px', border: '1px solid', borderColor: form.level === l ? '#c9a96e' : '#333', cursor: 'pointer', fontWeight: form.level === l ? 600 : 400 }}>
              {labels.levelLabels[l] ?? l}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>{labels.preferredStyle}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {STYLES.map((s) => (
            <button key={s} onClick={() => toggleStyle(s)}
              style={{ background: form.styles.includes(s) ? '#c9a96e' : '#1a1a1a', color: form.styles.includes(s) ? '#000' : '#555', fontSize: '11px', padding: '5px 12px', borderRadius: '16px', border: '1px solid', borderColor: form.styles.includes(s) ? '#c9a96e' : '#333', cursor: 'pointer', fontWeight: form.styles.includes(s) ? 600 : 400 }}>
              {STYLE_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>{labels.commLanguage}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {LOCALES.map(({ code, label }) => (
            <button key={code} onClick={() => save({ locale: code })}
              style={{ background: form.locale === code ? '#c9a96e' : '#1a1a1a', color: form.locale === code ? '#000' : '#555', fontSize: '11px', padding: '5px 12px', borderRadius: '16px', border: '1px solid', borderColor: form.locale === code ? '#c9a96e' : '#333', cursor: 'pointer', fontWeight: form.locale === code ? 600 : 400 }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ background: '#111', borderRadius: '8px', padding: '14px' }}>
        <div style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>{labels.notifications}</div>
        {([
          { key: 'notifyOrders' as const, label: labels.notifyOrdersLabel, sub: labels.notifyOrdersSub },
          { key: 'notifyNewBatches' as const, label: labels.notifyBatchesLabel, sub: labels.notifyBatchesSub },
          { key: 'notifyOffers' as const, label: labels.notifyOffersLabel, sub: labels.notifyOffersSub },
        ]).map(({ key, label, sub }) => (
          <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <div>
              <div style={{ fontSize: '12px', color: '#fff' }}>{label}</div>
              <div style={{ fontSize: '10px', color: '#555' }}>{sub}</div>
            </div>
            <div onClick={() => save({ [key]: !form[key] })}
              style={{ width: '36px', height: '20px', background: form[key] ? '#c9a96e' : '#333', borderRadius: '10px', position: 'relative', cursor: 'pointer' }}>
              <div style={{ width: '16px', height: '16px', background: form[key] ? '#000' : '#666', borderRadius: '50%', position: 'absolute', top: '2px', ...(form[key] ? { right: '2px' } : { left: '2px' }), transition: 'all 0.15s' }} />
            </div>
          </div>
        ))}

        <div style={{ borderTop: '1px solid #1a1a1a', paddingTop: '10px', marginTop: '4px' }}>
          {pushStatus === 'active' ? (
            <div style={{ fontSize: '11px', color: '#5a7a5a' }}>{labels.pushActive}</div>
          ) : pushStatus === 'denied' ? (
            <div style={{ fontSize: '11px', color: '#888' }}>{labels.pushDenied}</div>
          ) : pushStatus === 'unsupported' ? (
            <div style={{ fontSize: '11px', color: '#666' }}>{labels.pushUnsupported}</div>
          ) : pushStatus === 'loading' ? (
            <div style={{ fontSize: '11px', color: '#c9a96e', opacity: 0.6 }}>...</div>
          ) : pushStatus === 'error' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ fontSize: '10px', color: '#a05050', wordBreak: 'break-all' }}>Errore: {pushError}</div>
              <button onClick={enablePush} style={{ background: '#1a1a1a', color: '#c9a96e', border: '1px solid #c9a96e44', fontSize: '11px', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', width: 'fit-content' }}>
                Riprova
              </button>
            </div>
          ) : (
            <button onClick={enablePush}
              style={{ background: '#1a1a1a', color: '#c9a96e', border: '1px solid #c9a96e44', fontSize: '11px', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer' }}>
              {labels.pushEnable}
            </button>
          )}
        </div>
      </div>

      <div style={{ textAlign: 'center', paddingTop: '8px' }}>
        <button onClick={logout} style={{ background: 'transparent', border: 'none', color: '#444', fontSize: '11px', cursor: 'pointer' }}>
          {labels.logout}
        </button>
      </div>
    </div>
  )
}
