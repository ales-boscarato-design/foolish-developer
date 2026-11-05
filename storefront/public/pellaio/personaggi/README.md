# Figure dei sei ruoli del Pellaio

I ritagli che accompagnano le voci orarie di «Una giornata» nella pagina `/laboratorio`.

| Ruolo (canonico) | File | Dimensioni |
|---|---|---|
| Magazziniere | `pellaio-magazziniere.webp` | 341×720 |
| Segreteria | `pellaio-segretaria.webp` | 341×720 |
| Call center | `pellaio-call-center.webp` | 272×720 |
| Chimico | `pellaio-chimico.webp` | 236×720 |
| CEO | `pellaio-ceo.webp` | 293×720 |
| Pulizie | `pellaio-pulizie.webp` | 266×720 |

Totale 450 KB. WebP con trasparenza.

## Fonte

Turnaround sheet canonici del personaggio, lotto del **30/10**. I file qui presenti sono la copia
dei ritagli già derivati in `IL_PELLAIO/CHARACTER_SHEET_V2/DERIVED/WEB/site/`: non sono stati
rigenerati né ritagliati di nuovo per il sito.

## Metodo

1. ritaglio della **vista FRONT** del turnaround sheet (le altre viste non sono usate);
2. **segmentazione**: fondo rimosso, quindi trasparenza piena attorno alla figura;
3. **decontaminazione** del bordo, per togliere l'alone del fondo dai contorni.

## Stato

**Provvisorio.** Queste figure non sono l'hero della pagina: l'immagine principale del Pellaio
verrà generata dopo. Restano in pagina finché non arriva quella definitiva e non vanno trattate
come materiale di campagna.

## Limiti noti

- la larghezza originale dei ritagli è **236–341 px**, misurata sui sei file: la sorgente è tarata
  per una figura alta ~168 px resi (2x), non per ingrandimenti. In pagina l'altezza è normalizzata
  e la larghezza è automatica proprio perché le larghezze dei file sono diverse fra loro;
- resta una **frangia residua sui capelli** (il bordo morbido è il punto in cui la segmentazione
  è meno pulita): su fondi scuri si vede poco, su fondi chiari si vedrebbe. Se serve una figura
  su fondo chiaro va rifilata, non ingrandita.

## Manutenzione

La mappatura ruolo → file e le dimensioni intrinseche vivono in `storefront/src/lib/laboratorio.ts`
(`FIGURE_GIORNATA`); i test (`storefront/src/lib/laboratorio.test.ts`) confrontano quelle
dimensioni con l'header dei file veri, quindi una figura sostituita va aggiornata anche nella
tabella, altrimenti il test fallisce. Gli `alt` sono nei file lingua
(`storefront/messages/<lingua>.json`, `laboratorio.giornata.items[i].alt`).

_Ultimo aggiornamento: 5 novembre 2026._
