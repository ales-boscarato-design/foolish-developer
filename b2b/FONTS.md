# Font self-host — B2B

Il layout B2B (`b2b/src/app/layout.tsx`) non usa più `next/font/google`: i font sono
serviti dal repository, quindi la build non dipende più dalla rete e non può fallire
perché Google Fonts non risponde.

## Cosa è stato fatto

- I 12 file `.woff2` emessi dalla build baseline sono copiati byte-per-byte in
  `b2b/public/fonts/google/`. Sono gli stessi file che Next generava in `.next`,
  serviti ora come asset statici sotto `/fonts/google/`.
- Le 34 regole `@font-face` compilate dalla baseline (Outfit e Cormorant Garamond,
  tutti i subset, inclusi i due fallback `local(...)`) sono estratte in
  `b2b/src/app/google-fonts.css`, nello stesso ordine e con gli stessi descrittori.
  L'unica modifica è l'URL: da `url(../media/NOME.woff2)` a
  `url("/fonts/google/NOME.woff2")`.
- Le variabili `--font-outfit` e `--font-cormorant` sono dichiarate in `:root` dentro
  `b2b/src/app/globals.css` (prima arrivavano dalle classi generate da `next/font`).
- `b2b/src/app/layout.tsx` importa `./google-fonts.css` dopo `./globals.css` e
  precarica i tre file latin con `<link rel="preload" as="font" type="font/woff2"
  crossOrigin="anonymous">`.
- Le licenze originali sono in `b2b/public/fonts/OFL-Outfit.txt` e
  `b2b/public/fonts/OFL-Cormorant-Garamond.txt`.

## Provenienza

- Fonte: repository Google Fonts, commit
  `f391eb5d1f3c7d64eab1bf992b1aee045ac48ffb`.
- Famiglie: **Outfit** e **Cormorant Garamond**.
- Licenza: **SIL Open Font License 1.1** (testi integrali nei due file `OFL-*.txt`).

I file `.woff2` sono quelli emessi da Next per la build baseline, quindi byte-identici
ai sorgenti usati da quella build; i loro SHA-256 sono pinnati in
`b2b/scripts/verify-font-assets.mjs`.

## Come si rigenera

1. Con la rete disponibile, eseguire la build baseline:

   ```bash
   cd b2b && npm run build
   ```

2. Individuare il CSS compilato che contiene i blocchi `@font-face` (in
   `.next/static/css/` o `.next/static/chunks/`) e i `.woff2` in
   `.next/static/media/`.
3. Copiare i `.woff2` in `b2b/public/fonts/google/`.
4. Estrarre i blocchi `@font-face` in ordine di documento e riscrivere solo l'URL da
   `url(../media/NOME.woff2)` a `url("/fonts/google/NOME.woff2")`, scrivendo il
   risultato in `b2b/src/app/google-fonts.css`.
5. Aggiornare, se cambiano, gli SHA-256 e l'impronta attesa in
   `b2b/scripts/verify-font-assets.mjs`.

L'impronta delle facce è lo SHA-256 delle righe
`family|style|weight|display|NOMEFILE_woff2|unicode-range` unite da `\n` (senza
newline finale); per i fallback il campo `src` è il valore `local(...)` intero e
style/weight/display valgono `-` se assenti. Attesa: 34 righe, impronta
`af0caa90e5c4050023566910f9e8876ff8d0a2c136c242e10fe9c259c55df4a1`.

## Percorso pubblico e gate di auth

I file stanno in `b2b/public/fonts/` e vengono serviti da `/fonts/google/...`. Il middleware B2B
(`b2b/src/proxy.ts`) protegge ogni percorso che non sia in `PUBLIC_PATHS`: per questo `/fonts` è
elencato lì. Senza quella voce il browser di un ospite (pagina `/login`, `/catalogo`) riceve un
`307 → /login` al posto del font, la pagina resta senza font e ogni faccia costa un giro di rete.
Due test in `b2b/src/proxy.test.ts` sorvegliano la voce: se sparisce, diventano rossi.

## Come si verifica

```bash
cd b2b && npm run verify:fonts
```

Lo script `b2b/scripts/verify-font-assets.mjs` esce `1` se qualcosa non torna e `0`
se è tutto ok. Controlla:

- nessun riferimento a `next/font/google`, `next/font/local`,
  `fonts.googleapis.com`, `fonts.gstatic.com` nei sorgenti B2B;
- i 12 `.woff2` esistono con gli SHA-256 pinnati;
- `google-fonts.css` ha 34 facce, ogni `src` punta a `/fonts/google/`, ogni file
  citato esiste e l'impronta coincide con quella attesa;
- i due file OFL esistono e contengono `SIL OPEN FONT LICENSE`;
- se esiste un output di build, le facce estratte dal CSS compilato hanno la stessa
  impronta (parità col compilato).

## Prova offline

Con la rete disabilitata (o con Google Fonts irraggiungibile), la build deve comunque
passare perché non contatta più alcun CDN:

```bash
cd b2b && npm run build
```

Verifica esplicita che l'output di build non citi più i CDN Google:

```bash
cd b2b && grep -rIl -e fonts.googleapis.com -e fonts.gstatic.com .next ; echo "exit=$?"
```

Un `exit=1` (nessun file trovato) è il risultato atteso.
