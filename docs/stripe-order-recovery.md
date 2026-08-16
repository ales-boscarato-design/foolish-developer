# Recupero pagamenti Stripe senza ordine CMS

Questa procedura è il percorso operativo supportato quando un pagamento Stripe
risulta riuscito ma l'ordine non è visibile nel CMS. Non modificare direttamente
PostgreSQL e non ricreare a mano un ordine prima di aver eseguito la
riconciliazione: `orderNumber` è univoco e webhook e cron sono idempotenti.

## Protezioni automatiche

1. Il checkout verifica l'accesso ordini al CMS prima di creare una sessione
   Stripe.
2. Il webhook `checkout.session.completed` prova la persistenza fino a quattro
   volte. Se fallisce risponde HTTP 503, così Stripe mantiene i retry attivi.
3. Il cron `stripe-reconcile` confronta ogni 15 minuti le sessioni live pagate
   con gli ordini CMS e recupera quelle mancanti.
4. L'audit giornaliero usa una finestra fino a 365 giorni.
5. Un'anomalia o un heartbeat esplicito viene inviato indipendentemente ad
   Alfred e via email Resend.

## Procedura da PaymentIntent

1. Leggere il PaymentIntent con `stripe_payment_intent_get` e verificare che lo
   stato sia `succeeded`. Annotare soltanto ID, importo, valuta e metadata utili;
   non copiare credenziali o dati carta.
2. Usare `foolish_stripe_observe` o gli strumenti Stripe in sola lettura per
   trovare la Checkout Session collegata e il metadata `order_ref`.
3. Cercare `order_ref` con `foolish_order_get`. Se l'ordine esiste, non creare
   nulla: controllare soltanto stato pipeline e notifiche.
4. Se manca, eseguire il cron autenticato `stripe-reconcile` con una finestra
   che includa la data del pagamento. Il segreto deve provenire dall'ambiente
   Railway e non deve apparire nel comando, nei log o nella chat.
5. Ripetere `foolish_order_get` e verificare importo, valuta, cliente e righe.
6. Se la riconciliazione fallisce, conservare PaymentIntent, Checkout Session,
   `order_ref`, HTTP status CMS e deployment Storefront; inviare l'allarme e
   correggere la causa prima di un secondo tentativo.

## Procedura da Checkout Session

1. Verificare che sia live, `mode=payment` e `payment_status=paid`.
2. Verificare che contenga `metadata.order_ref` oppure `metadata.items_json`;
   sessioni Stripe estranee allo Storefront non devono diventare ordini.
3. Cercare l'ordine CMS per `order_ref`.
4. Se manca, usare la riconciliazione automatica. La sessione completa viene
   riletta da Stripe per recuperare anche l'indirizzo di spedizione.
5. Confermare che il risultato riporti l'ordine in `recovered` e nessun elemento
   in `errors`, poi rileggere l'ordine dal CMS.

## Verifica e chiusura incidente

- Il conteggio sessioni pagate idonee deve uguagliare `alreadyPresent +
  recovered + errors`.
- `errors` deve essere vuoto.
- Una seconda esecuzione deve riportare l'ordine come già presente e non creare
  duplicati.
- Alfred non deve creare `order-check-N/A` per heartbeat o audit.
- Registrare orario di rilevazione, orario di recupero, causa, commit/deployment
  correttivo e prova dei due canali di allarme.

## Escalation

Se webhook e riconciliazione falliscono entrambi, mantenere il webhook in errore
503, non disabilitare i retry Stripe e non rispondere manualmente 2xx. Ripristinare
il precedente deployment Storefront o CMS se il problema coincide con un deploy;
quindi rieseguire la riconciliazione. La creazione manuale attraverso
`foolish_cms_create` è l'ultima risorsa e richiede anteprima, conferma esplicita
e verifica preventiva che `order_ref` non esista.
