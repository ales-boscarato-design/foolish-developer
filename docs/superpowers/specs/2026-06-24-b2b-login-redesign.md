# B2B Login Redesign — Design Spec

**Data:** 2026-06-24  
**Scope:** `foolish-storefront/b2b/`  
**Obiettivo:** Sostituire il sistema di login complesso (magic link + classic login) con email + password con auto-registrazione self-service.

---

## Problema attuale

Il portale rivenditori (`b2b/`) ha due sistemi di login paralleli:
1. **Magic link** — il rivenditore inserisce l'email, riceve un link via email valido 15 minuti, clicca il link. Poco comprensibile per utenti non tecnici.
2. **Classic login** — email + nome attività + telefono. Fragile: basta un carattere diverso nel nome attività per bloccarsi.

Entrambi richiedono che il rivenditore sia **già presente nel DB `pro_members` con status `active`**, inserito manualmente dall'admin. Se il record non esiste, accesso impossibile.

**Risultato:** rivenditori bloccati, richieste di supporto, frustrazione.

---

## Nuovo sistema

### Form unico smart (login + registrazione)

Un'unica pagina `/login` con form progressivo:

**Step 1 — Email**
- Campo: email
- Click "Continua"
- Backend controlla se l'email esiste già in `pro_members`

**Step 2a — Email nuova (registrazione)**
- Appaiono: campo password + campo nome attività
- Click "Registrati e accedi"
- Backend: crea `pro_members`, invia welcome email, crea sessione

**Step 2b — Email esistente (accesso)**
- Appare: solo campo password
- Click "Accedi"
- Backend: verifica bcrypt, crea sessione

### Accesso immediato
Non c'è approvazione admin. Il rivenditore registrato entra subito nel catalogo.

---

## Flusso registrazione

```
Rivenditore inserisce email + password + nome attività
        ↓
Backend: INSERT INTO pro_members (email, business_name, password_hash, status='active')
        ↓
Resend: welcome email al rivenditore
        ↓
Resend: BCC a support.foolish@agentmail.to (notifica Frank)
        ↓
Umami: track evento 'reseller_register'
        ↓
JWT session cookie creato (30 giorni)
        ↓
Redirect a /catalogo
```

## Flusso login successivo

```
Rivenditore inserisce email → esiste → inserisce password
        ↓
Backend: bcrypt.compare(password, password_hash)
        ↓
JWT session cookie creato
        ↓
Umami: track evento 'reseller_login' (LoginTracker già esistente)
        ↓
Redirect a /catalogo
```

## Flusso rivenditore esistente senza password (migrazione)

I `pro_members` già presenti nel DB non hanno `password_hash`. Al loro primo accesso:
- Il backend rileva che l'email esiste ma `password_hash IS NULL`
- Tratta come registrazione: mostra campo password + nome attività (pre-compilato se già presente)
- La prima password inserita diventa la loro password permanente
- Nessuna welcome email (non sono nuovi), ma Frank riceve notifica di attivazione

---

## Modifiche al database

```sql
ALTER TABLE pro_members ADD COLUMN password_hash TEXT;
```

Colonna nullable: i record esistenti rimangono validi, si attivano al primo accesso.

---

## Componenti da rimuovere

| File | Motivo |
|------|--------|
| `src/app/api/auth/magic-link/route.ts` | Magic link eliminato |
| `src/app/api/auth/verify/route.ts` | Magic link eliminato |
| `src/app/auth/verify/page.tsx` | Magic link eliminato |
| `src/app/api/auth/classic-login/route.ts` | Classic login eliminato |
| `src/lib/auth.ts` → `createMagicToken`, `verifyMagicToken` | Non più usate |

---

## Componenti da aggiungere/modificare

| File | Modifica |
|------|----------|
| `src/app/login/page.tsx` | Riscrivere: form progressivo email → password (+nome attività se nuovo) |
| `src/app/api/auth/login/route.ts` | Nuovo: gestisce login + registrazione in un unico endpoint |
| `src/lib/auth.ts` | Rimuovere magic token, aggiungere `hashPassword` e `verifyPassword` (bcrypt) |
| `src/lib/db.ts` | Aggiungere `findOrCreateProMember`, rimuovere `authenticateClassicLogin` |
| `src/lib/resend.ts` | Aggiungere `sendWelcomeEmail`, rimuovere `sendMagicLink` |
| `src/components/LoginTracker.tsx` | Aggiungere tracking `reseller_register` |

---

## Email di benvenuto (Resend)

**A:** rivenditore  
**Da:** `The Foolish Butcher <ordini@updates.thefoolishbutcher.com>`  
**BCC:** `support.foolish@agentmail.to` (Frank)  
**Oggetto:** Benvenuto nell'area rivenditori — The Foolish Butcher  
**Contenuto:** saluto con nome attività, link al catalogo, contatto supporto

---

## Umami tracking

| Evento | Quando |
|--------|--------|
| `reseller_register` | Prima registrazione completata |
| `reseller_login` | Accesso successivo (già implementato in `LoginTracker`) |

Umami è già configurato in `layout.tsx` (website-id `99ca3a08-ff9b-4310-94ea-567d6a32d188`).

---

## Sessione

Invariata: JWT cookie `b2b_session`, httpOnly, 30 giorni, firmato con `B2B_SESSION_SECRET`.  
`B2B_MAGIC_SECRET` non più necessario (può essere rimosso dalle variabili Railway).

---

## Dipendenze

- `bcryptjs` (o `bcrypt`) da aggiungere a `b2b/package.json`
- Nessuna nuova variabile d'ambiente necessaria (Resend e DB già configurati)
