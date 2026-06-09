#!/usr/bin/env node
/**
 * Update usageSteps, whatsInTheBox, featureHighlights for Foolish products
 * Uses Payload's local API to properly handle localized arrays.
 */
const { getPayload } = require('payload')
const path = require('path')

// Payload config path
process.env.PAYLOAD_CONFIG_PATH = path.resolve(__dirname, '..', 'payload.config.ts')
// Use compiled JS
const config = require(path.resolve(__dirname, '..', 'dist', 'payload.config.js'))

async function main() {
  console.log('Initializing Payload...')
  
  // Use railway run with --service CMS to get env vars
  const payload = await getPayload({ config })
  
  console.log('Updating products...')
  
  // ===================== DATA =====================
  
  // T-Sheet DBL (ID 33)
  const usageDBL = [
    {
      step: '1',
      title: { it: 'Prepara', en: 'Prep', fr: 'Prépare', es: 'Prepara', de: 'Vorbereiten' },
      description: {
        it: 'Sgrassa la superficie con alcol per rimuovere polvere e residui di produzione',
        en: 'Wipe the surface with alcohol to remove dust and production residues',
        fr: 'Nettoie la surface avec de l\'alcool pour enlever poussière et résidus de production',
        es: 'Limpia la superficie con alcohol para eliminar polvo y residuos de producción',
        de: 'Reinige die Oberfläche mit Alkohol, um Staub und Produktionsrückstände zu entfernen'
      }
    },
    {
      step: '2',
      title: { it: 'Stencil', en: 'Stencil', fr: 'Stencil', es: 'Esténcil', de: 'Stencil' },
      description: {
        it: 'Applica il gel o saponetta per transfer. Se è cremoso, massaggialo sulla pelle finché diventa appiccicoso. Applica lo stencil, premi qualche secondo — niente phon, niente attesa 24h. Rimuovi e verifica il trasferimento. Lascia asciugare 20-30 minuti',
        en: 'Apply your transfer gel or soap. If creamy, massage it onto the skin until tacky. Place the stencil, press for a few seconds — no hair dryer, no 24h wait. Peel off and check the transfer. Let dry for 20-30 minutes',
        fr: 'Applique ton gel ou savon à transfert. S\'il est crémeux, masse-le sur la peau jusqu\'à ce qu\'il devienne collant. Pose le stencil, appuie quelques secondes — pas de sèche-cheveux, pas d\'attente 24h. Retire et vérifie le transfert. Laisse sécher 20-30 minutes',
        es: 'Aplica tu gel o jabón para transferencia. Si es cremoso, masajéalo sobre la piel hasta que se vuelva pegajoso. Coloca el esténcil, presiona unos segundos — sin secador, sin espera 24h. Retira y verifica la transferencia. Deja secar 20-30 minutos',
        de: 'Trage Transfergel oder -seife auf. Ist es cremig, massiere es auf der Haut ein, bis es klebrig wird. Lege das Stencil auf, drücke einige Sekunden — kein Föhn, keine 24h Wartezeit. Entferne und prüfe die Übertragung. 20-30 Minuten trocknen lassen'
      }
    },
    {
      step: '3',
      title: { it: 'Tatua', en: 'Tattoo', fr: 'Tatoue', es: 'Tatúa', de: 'Tätowieren' },
      description: {
        it: 'Parti dal basso del disegno. Sui contorni, segui il profilo senza passare sullo stencil fresco. Pulisci con vaselina durante il lavoro. Usa il lato carnato per la pratica realistica, il lato bianco per valutare a contrasto la qualità del tuo lavoro',
        en: 'Start from the bottom of the design. On outlines, follow the profile without going over the fresh stencil. Clean with Vaseline during work. Use the skin side for realistic practice, the white side for high-contrast quality evaluation',
        fr: 'Commence par le bas du dessin. Sur les contours, suis le profil sans passer sur le stencil frais. Nettoie avec de la vaseline pendant le travail. Utilise le côté chair pour la pratique réaliste, le côté blanc pour évaluer le contraste',
        es: 'Empieza desde abajo del diseño. En los contornos, sigue el perfil sin pasar sobre el esténcil fresco. Limpia con vaselina durante el trabajo. Usa el lado carne para práctica realista, el lado blanco para evaluar el contraste de tu trabajo',
        de: 'Beginne unten am Motiv. Folge an den Konturen dem Profil, ohne das frische Stencil zu überfahren. Reinige mit Vaseline während der Arbeit. Nutze die Hautseite für realistisches Üben, die weiße Seite zur kontrastreichen Qualitätskontrolle'
      }
    },
    {
      step: '4',
      title: { it: 'Post', en: 'Aftercare', fr: 'Après', es: 'Post', de: 'Nachsorge' },
      description: {
        it: 'A lavoro finito, lava la pelle con acqua e sapone e asciuga. Stendi un velo spesso di vaselina su tutta la superficie e metti il pezzo in una busta o cellophan per 24-48 ore: la pelle suda ed espelle l\'inchiostro in eccesso. Trascorso il tempo, lava, asciuga e applica una crema idratante per mantenere il tatuaggio lucido',
        en: 'When finished, wash the skin with soap and water, pat dry. Apply a thick layer of Vaseline and wrap in a bag or cling film for 24-48 hours: the skin sweats and expels excess ink. Then wash, dry and apply moisturizing cream to keep the tattoo glossy',
        fr: 'Une fois fini, lave la peau avec eau et savon, sèche. Applique une couche épaisse de vaseline et mets dans un sac ou film plastique 24-48h : la peau transpire et expulse l\'excès d\'encre. Après, lave, sèche et applique une crème hydratante pour garder le tatouage brillant',
        es: 'Al terminar, lava la piel con agua y jabón, seca. Aplica una capa gruesa de vaselina y mete en bolsa o film 24-48h: la piel suda y expulsa el exceso de tinta. Después, lava, seca y aplica crema hidratante para mantener el tatuaje brillante',
        de: 'Wasche die Haut nach Fertigstellung mit Wasser und Seife, trockne sie. Trage eine dicke Schicht Vaseline auf und wickle sie 24-48h in Plastikfolie oder einen Beutel: die Haut schwitzt und stößt überschüssige Tinte aus. Danach waschen, trocknen und Feuchtigkeitscreme auftragen, um das Tattoo glänzend zu halten'
      }
    }
  ]
  
  // Duoskin (same as DBL but with dual-face + thickness note in step 3)
  const usageDuoskin = JSON.parse(JSON.stringify(usageDBL.map((s, i) => {
    if (i === 2) { // Step 3 - Tattoo
      s.description = {
        it: 'Entrambi i lati hanno la stessa texture: usa il primo lato per un disegno, il secondo per un altro esercizio. Lo spessore maggiore (6-8mm) dà un feedback d\'ago più profondo, ideale per simulare la resistenza della pelle reale. Parti dal basso, pulisci con vaselina',
        en: 'Both sides have the same texture: use the first side for one design, the second for another exercise. The thicker gauge (6-8mm) gives deeper needle feedback, ideal for simulating real skin resistance. Start from the bottom, clean with Vaseline',
        fr: 'Les deux faces ont la même texture : utilise un côté pour un dessin, l\'autre pour un autre exercice. L\'épaisseur (6-8mm) donne un retour d\'aiguille plus profond. Commence par le bas, nettoie avec de la vaseline',
        es: 'Ambos lados tienen la misma textura: usa un lado para un diseño, el otro para otro ejercicio. El mayor grosor (6-8mm) da un feedback de aguja más profundo. Empieza desde abajo, limpia con vaselina',
        de: 'Beide Seiten haben die gleiche Textur: nutze eine Seite für ein Motiv, die andere für eine weitere Übung. Die dickere Stärke (6-8mm) gibt tieferes Nadel-Feedback. Beginne unten, reinige mit Vaseline'
      }
    }
    return s
  })))
  
  const updates = [
    { id: 33, data: { usageSteps: usageDBL }, name: 'T-Sheet DBL' },
    { id: 34, data: { usageSteps: usageDuoskin }, name: 'Duoskin' },
  ]
  
  for (const { id, data, name } of updates) {
    console.log(`Updating ${name} (ID ${id})...`)
    try {
      const result = await payload.update({
        collection: 'products',
        id,
        locale: 'all',
        data,
        depth: 0,
      })
      const steps = result.usageSteps?.length || 0
      console.log(`  ✓ Updated: ${steps} usageSteps`)
    } catch (err) {
      console.error(`  ✗ Error: ${err.message}`)
    }
  }
  
  console.log('\nDone!')
  process.exit(0)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
