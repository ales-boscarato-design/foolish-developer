// Foolish — Import prodotti CMS (5 lingue)
// Uso: node import-products.mjs
// Carica shortDescription, uniqueNote, featureHighlights, usageSteps, whatsInTheBox, description

const API_BASE = 'https://cms-production-1dda.up.railway.app/api'
const WARMUP = 'https://cms-production-1dda.up.railway.app'
const EMAIL = 'boscaratoa@icloud.com'
const PASSWORD = 'P123arrucc0?!'
const LOCALES = ['it', 'en', 'fr', 'es', 'de']

let TOKEN = null

// ──────────────────────────────────────────
// Lexical converter
// ──────────────────────────────────────────

function makeText(text, format = 0) {
  return { type: 'text', version: 1, text, format, detail: 0, mode: 'normal', style: '' }
}

function lexParagraph(text, boldSegments = []) {
  const children = []
  if (boldSegments.length === 0) {
    children.push(makeText(text, 0))
  } else {
    let remaining = text
    for (const seg of boldSegments) {
      const idx = remaining.indexOf(seg.text)
      if (idx > 0) children.push(makeText(remaining.slice(0, idx), 0))
      if (idx >= 0) {
        children.push(makeText(seg.text, seg.bold ? 1 : 0))
        remaining = remaining.slice(idx + seg.text.length)
      }
    }
    if (remaining) children.push(makeText(remaining, 0))
  }
  return { type: 'paragraph', version: 1, children }
}

function lexDescription(...paragraphs) {
  return { root: { type: 'root', version: 1, children: paragraphs, direction: 'ltr', format: '', indent: 0 } }
}

// ──────────────────────────────────────────
// API helpers
// ──────────────────────────────────────────

async function api(method, path, body = null, locale = null, queryParams = {}) {
  let urlStr = path.startsWith('http') ? path : `${API_BASE}${path}`
  const separator = path.includes('?') ? '&' : '?'
  if (locale) urlStr += `${separator}locale=${locale}`
  let finalUrl = urlStr
  if (Object.keys(queryParams).length > 0) {
    const qs = Object.entries(queryParams)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&')
    finalUrl = urlStr + (urlStr.includes('?') ? '&' : '?') + qs
  }
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' }
  }
  if (TOKEN) opts.headers['Authorization'] = `Bearer ${TOKEN}`
  if (body) opts.body = JSON.stringify(body)

  const res = await fetch(finalUrl, opts)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${method} ${path} (${locale || '-'}) → ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json()
}

// ──────────────────────────────────────────
// Prodotti data
// ──────────────────────────────────────────

const DATA = {}

// --- T-Sheet DBL ---
DATA['t-sheet-dbl'] = {
  it: {
    shortDescription: "Due facce: carnato e bianco a contrasto. Ogni linea, saturazione e sfumatura la vedi per com'è.",
    uniqueNote: "Ogni foglio è unico. Impasto fresco ogni giorno, colore a flock dosato a mano. Nessuna pelle è identica a un'altra — come sulla pelle del cliente.",
    description: lexDescription(
      lexParagraph("Su una pelle color carne l'occhio combatte sempre col tono: finisci il pezzo e non sei mai sicuro al 100% di quanto sia pulita la linea. Il DBL ha due facce, e una è fatta apposta per toglierti ogni dubbio."),
      lexParagraph("Come ogni pelle Foolish: impasto siliconico fatto fresco ogni giorno, colore a flock per discromie naturali, micropori per lo stencil, texture iperrealistica. Niente stampi in serie."),
      lexParagraph("Faccia bianca — tela a contrasto puro. Nessun tono a disturbare: line weight, saturazione e transizioni di sfumatura si leggono per come sono davvero. Becchi una linea che balla, un'area troppo carica o un blowout all'istante. È la faccia che ti dice la verità — e, come effetto collaterale, fotografa da dio.", [{ text: 'Faccia bianca — tela a contrasto puro.', bold: true }]),
      lexParagraph("Faccia color pelle — realismo completo. Flock, traslucenza, pori: la resa dell'inchiostro come su incarnato vero, quando vuoi allenarti sul risultato finale.", [{ text: 'Faccia color pelle — realismo completo.', bold: true }]),
      lexParagraph("Più dura e tesa sul lato bianco, per emulare la pelle tirata in fase di lining."),
      lexParagraph("Per chi vuole studiare e mostrare il proprio linework con zero rumore, e insieme allenarsi sulla resa reale del colore. Lining, dotwork, blackwork, e chiunque viva di portfolio.")
    ),
    featureHighlights: [
      { icon: '1️⃣', title: 'Due facce, due lavori', description: 'Faccia carnato per pratica realistica, faccia bianca per valutazione a contrasto puro' },
      { icon: '2️⃣', title: 'Più tesa sul lato bianco', description: 'Emula la pelle tirata in fase di lining per un training più fedele' },
      { icon: '3️⃣', title: 'Texture iperrealistica', description: "Flock, micropori, traslucenza: l'inchiostro si comporta come su pelle vera" },
      { icon: '4️⃣', title: 'Fotografa da dio', description: 'La faccia bianca è una tela da portfolio pronta, senza ritocchi' }
    ],
    usageSteps: [
      { step: 1, title: 'Prepara', description: 'Sgrassalo con alcol, applica lo stencil, attendi 15 minuti' },
      { step: 2, title: 'Lavora', description: 'Tatua sul lato carnato per pratica realistica, sul bianco per verificare la qualità del tuo lavoro' },
      { step: 3, title: 'Valuta', description: 'Confronta i due risultati: line weight, saturazione, blowout — tutto si vede senza incertezze' }
    ],
    whatsInTheBox: ['Foglio singolo T-Sheet DBL', 'Busta richiudibile per conservazione', 'Scheda prodotto con codici lotto e data produzione']
  },
  en: {
    shortDescription: 'Two faces: skin-tone and white contrast. Every line, shade, and color reads for what it really is.',
    uniqueNote: 'Every sheet is unique. Fresh silicone mix daily, flock color dosed by hand. No two skins are identical — just like real human skin.',
    description: lexDescription(
      lexParagraph("On flesh-toned skin your eye is always fighting the undertone: you finish a piece and you're never 100% sure how clean that line is. The DBL has two faces, and one was made to take every doubt away."),
      lexParagraph('Like every Foolish skin: silicone mix made fresh daily, flock coloring for natural dyschromia, micropores for stencil grip, hyperrealistic texture. No serial molds — ever.'),
      lexParagraph('White face — pure contrast canvas. No undertone in the way: line weight, saturation, and shading transitions read exactly as they are. You catch a wobbly line, an overloaded area, or a blowout instantly. It\'s the face that tells you the truth — and as a side effect, it photographs like a dream.', [{ text: 'White face — pure contrast canvas.', bold: true }]),
      lexParagraph('Skin-toned face — full realism. Flock, translucency, pores: ink behaves like on real skin when you want to train for the final result.', [{ text: 'Skin-toned face — full realism.', bold: true }]),
      lexParagraph('Firmer and tighter on the white side, to mimic stretched skin during lining.'),
      lexParagraph('For artists who want to study and show their linework with zero noise, and train on real color behavior at the same time. Lining, dotwork, blackwork — anyone who lives by their portfolio.')
    ),
    featureHighlights: [
      { icon: '1️⃣', title: 'Two faces, two jobs', description: 'Skin-tone side for realistic practice, white side for pure contrast evaluation' },
      { icon: '2️⃣', title: 'Tighter on the white side', description: 'Mimics stretched skin during lining for more faithful training' },
      { icon: '3️⃣', title: 'Hyperrealistic texture', description: 'Flock, micropores, translucency: ink behaves like on real skin' },
      { icon: '4️⃣', title: 'Portfolio-ready', description: 'The white face photographs like a dream, no retouching needed' }
    ],
    usageSteps: [
      { step: 1, title: 'Prep', description: 'Wipe with alcohol, apply stencil, wait 15 minutes' },
      { step: 2, title: 'Work', description: 'Tattoo the skin side for realistic practice, the white side to check your work quality' },
      { step: 3, title: 'Review', description: 'Compare both results: line weight, saturation, blowouts — everything reads clearly' }
    ],
    whatsInTheBox: ['Single T-Sheet DBL sheet', 'Resealable storage pouch', 'Product card with batch code and production date']
  },
  fr: {
    shortDescription: "Deux faces : chair et blanc contraste. Chaque ligne, saturation et fondu se lit pour ce qu'elle est.",
    uniqueNote: "Chaque feuille est unique. Mélange frais chaque jour, couleur au flock dosée à la main. Aucune peau n'est identique à une autre — comme sur la peau du client.",
    description: lexDescription(
      lexParagraph("Sur une peau couleur chair, ton œil lutte toujours contre le fond : tu finis un morceau et t'es jamais sûr à 100% de la netteté de tes lignes. Le DBL a deux faces, et l'une est là pour te foutre la paix avec le doute."),
      lexParagraph('Comme chaque peau Foolish : mélange silicone frais chaque jour, couleur au flock pour les dyschromies naturelles, micropores pour l\'accroche du stencil, texture hyperréaliste. Pas de moules en série.'),
      lexParagraph("Face blanche — toile à contraste pur. Aucun ton qui vient fausser le coup d'œil : épaisseur de ligne, saturation, transitions de fondu se lisent pour ce qu'elles sont. Tu repères une ligne qui danse, une zone trop chargée ou un blowout en un regard. C'est la face qui dit la vérité — et en prime, elle est ultra photogénique.", [{ text: 'Face blanche — toile à contraste pur.', bold: true }]),
      lexParagraph('Face couleur chair — réalisme complet. Flock, translucidité, pores : le comportement de l\'encre comme sur une vraie peau, pour t\'entraîner sur le résultat final.', [{ text: 'Face couleur chair — réalisme complet.', bold: true }]),
      lexParagraph('Plus ferme et plus tendue côté blanc, pour imiter la peau tendue pendant le lining.'),
      lexParagraph("Pour ceux qui veulent étudier et montrer leur linework sans bruit parasite, tout en s'entraînant sur le rendu réel des couleurs. Lining, dotwork, blackwork — tous ceux qui vivent pour leur portfolio.")
    ),
    featureHighlights: [
      { icon: '1️⃣', title: 'Deux faces, deux usages', description: 'Face chair pour pratique réaliste, face blanche pour évaluation à contraste pur' },
      { icon: '2️⃣', title: 'Plus tendue côté blanc', description: 'Imite la peau tendue pendant le lining pour un entraînement fidèle' },
      { icon: '3️⃣', title: 'Texture hyperréaliste', description: "Flock, micropores, translucidité : l'encre se comporte comme sur la vraie peau" },
      { icon: '4️⃣', title: 'Prête pour le portfolio', description: 'La face blanche photographie sans retouche' }
    ],
    usageSteps: [
      { step: 1, title: 'Prépare', description: "Nettoie à l'alcool, applique le stencil, attends 15 minutes" },
      { step: 2, title: 'Travaille', description: 'Tatoue le côté chair pour la pratique réaliste, le côté blanc pour vérifier la qualité' },
      { step: 3, title: 'Évalue', description: 'Compare les deux résultats : épaisseur de ligne, saturation, blowouts — tout se voit sans ambiguïté' }
    ],
    whatsInTheBox: ['Feuille unique T-Sheet DBL', 'Pochette refermable', 'Fiche produit avec code lot et date de production']
  },
  es: {
    shortDescription: 'Dos caras: carne y blanco contraste. Cada línea, saturación y sombreado se lee tal cual es.',
    uniqueNote: 'Cada lámina es única. Mezcla fresca cada día, color con flock dosificado a mano. Ninguna piel es idéntica a otra — como en la piel del cliente.',
    description: lexDescription(
      lexParagraph('Sobre una piel color carne, tu ojo siempre lucha contra el fondo: terminas una pieza y nunca estás 100% seguro de lo limpia que quedó esa línea. El DBL tiene dos caras, y una está hecha para sacarte todas las dudas de encima.'),
      lexParagraph('Como cada piel Foolish: mezcla de silicona fresca cada día, color con flock para discromías naturales, microporos para el agarre del esténcil, textura hiperrealista. Nada de moldes en serie.'),
      lexParagraph('Cara blanca — lienzo de contraste puro. Ningún tono que interfiera: el peso de la línea, la saturación y las transiciones de sombreado se leen tal cual son. Cazas una línea que baila, una zona sobrecargada o un blowout al instante. Es la cara que te dice la verdad — y de paso, fotografía de puta madre.', [{ text: 'Cara blanca — lienzo de contraste puro.', bold: true }]),
      lexParagraph('Cara color carne — realismo completo. Flock, translucidez, poros: el comportamiento de la tinta como en piel real, cuando quieres entrenar para el resultado final.', [{ text: 'Cara color carne — realismo completo.', bold: true }]),
      lexParagraph('Más firme y tensa en el lado blanco, para imitar la piel estirada durante el lining.'),
      lexParagraph('Para quien quiere estudiar y mostrar su linework con cero ruido, y al mismo tiempo entrenar en la reproducción real del color. Lining, dotwork, blackwork — cualquiera que viva de su portfolio.')
    ),
    featureHighlights: [
      { icon: '1️⃣', title: 'Dos caras, dos trabajos', description: 'Cara carne para práctica realista, cara blanca para evaluación a contraste puro' },
      { icon: '2️⃣', title: 'Más tensa en el lado blanco', description: 'Imita la piel estirada durante el lining para un entrenamiento fiel' },
      { icon: '3️⃣', title: 'Textura hiperrealista', description: 'Flock, microporos, translucidez: la tinta se comporta como en piel real' },
      { icon: '4️⃣', title: 'Lista para portfolio', description: 'La cara blanca fotografía sin retoques' }
    ],
    usageSteps: [
      { step: 1, title: 'Prepara', description: 'Limpia con alcohol, aplica el esténcil, espera 15 minutos' },
      { step: 2, title: 'Trabaja', description: 'Tatúa el lado carne para práctica realista, el blanco para verificar la calidad' },
      { step: 3, title: 'Evalúa', description: 'Compara los resultados: peso de línea, saturación, blowouts — todo se ve claro' }
    ],
    whatsInTheBox: ['Lámina individual T-Sheet DBL', 'Bolsa reutilizable', 'Tarjeta de producto con código de lote y fecha de producción']
  },
  de: {
    shortDescription: 'Zwei Seiten: hautfarben und weißer Kontrast. Jede Linie, Sättigung und Schattierung liest sich wie sie ist.',
    uniqueNote: 'Jedes Blatt ist ein Unikat. Frische Silikonmischung täglich, Flock-Farbe von Hand dosiert. Keine Haut gleicht der anderen — genau wie echte menschliche Haut.',
    description: lexDescription(
      lexParagraph('Auf einer hautfarbenen Unterlage kämpft dein Auge immer mit dem Ton: du beendest ein Stück und bist nie 100% sicher, wie sauber die Linie wirklich ist. Der DBL hat zwei Seiten, und eine wurde gemacht, um dir jeden Zweifel zu nehmen.'),
      lexParagraph('Wie jede Foolish-Haut: frische Silikonmischung täglich, Flock-Färbung für natürliche Dyschromie, Mikroporen für Stencil-Haftung, hyperrealistische Textur. Keine Serienformen — nie.'),
      lexParagraph('Weiße Seite — reine Kontrastfläche. Kein störender Hintergrundton: Linienstärke, Sättigung und Schattierungsübergänge lesen sich genau so, wie sie sind. Du erkennst eine tanzende Linie, eine überladene Stelle oder einen Blowout sofort. Es ist die Seite, die dir die Wahrheit sagt — und nebenbei fotografiert sie wie ein Traum.', [{ text: 'Weiße Seite — reine Kontrastfläche.', bold: true }]),
      lexParagraph('Hautfarbene Seite — voller Realismus. Flock, Transluzenz, Poren: das Tintenverhalten wie auf echter Haut, wenn du für das Endergebnis trainieren willst.', [{ text: 'Hautfarbene Seite — voller Realismus.', bold: true }]),
      lexParagraph('Fester und straffer auf der weißen Seite, um gestraffte Haut beim Lining zu simulieren.'),
      lexParagraph('Für Künstler, die ihr Linework ohne Störung studieren und zeigen wollen, und gleichzeitig an echtem Farbverhalten trainieren möchten. Lining, Dotwork, Blackwork — alle, die von ihrem Portfolio leben.')
    ),
    featureHighlights: [
      { icon: '1️⃣', title: 'Zwei Seiten, zwei Jobs', description: 'Hautseite für realistisches Üben, weiße Seite für reinen Kontrast' },
      { icon: '2️⃣', title: 'Straffer auf der weißen Seite', description: 'Simuliert gestraffte Haut beim Lining für realistischeres Training' },
      { icon: '3️⃣', title: 'Hyperrealistische Textur', description: 'Flock, Mikroporen, Transluzenz: Tinte verhält sich wie auf echter Haut' },
      { icon: '4️⃣', title: 'Portfolio-bereit', description: 'Die weiße Seite fotografiert ohne Nachbearbeitung' }
    ],
    usageSteps: [
      { step: 1, title: 'Vorbereiten', description: 'Mit Alkohol reinigen, Stencil auftragen, 15 Minuten warten' },
      { step: 2, title: 'Arbeiten', description: 'Auf der Hautseite für realistisches Üben tätowieren, auf der weißen Seite zur Qualitätskontrolle' },
      { step: 3, title: 'Prüfen', description: 'Beide Ergebnisse vergleichen: Linienstärke, Sättigung, Blowouts — alles klar erkennbar' }
    ],
    whatsInTheBox: ['Einzelblatt T-Sheet DBL', 'Wiederverschließbare Tasche', 'Produktkarte mit Chargencode und Herstellungsdatum']
  }
}

// --- DUOSKIN ---
DATA['duoskin'] = {}
for (const loc of LOCALES) {
  DATA['duoskin'][loc] = {
    shortDescription: loc === 'it' ? 'La più spessa della linea: 6-8mm di resistenza vera. Due facce identiche per feedback ago più profondo.' :
                       loc === 'en' ? 'The thickest practice skin: 6-8mm of real resistance. Two identical faces for deeper needle feedback.' :
                       loc === 'fr' ? "La plus épaisse de la gamme : 6-8mm de vraie résistance. Deux faces identiques pour un retour d'aiguille plus profond." :
                       loc === 'es' ? 'La más gruesa de la línea: 6-8mm de resistencia real. Dos caras idénticas para retroalimentación de aguja más profunda.' :
                       'Die dickste Übungshaut der Linie: 6-8mm echter Widerstand. Zwei identische Seiten für tieferes Nadel-Feedback.',
    uniqueNote: loc === 'it' ? 'La più spessa della linea, con la stessa texture iperrealistica di ogni foglio Foolish. Le due facce identiche raddoppiano la superficie utile senza sacrificare la qualità di training.' :
                loc === 'en' ? 'The thickest in the line, with the same hyperrealistic texture as every Foolish sheet. Two identical faces double your practice area without sacrificing training quality.' :
                loc === 'fr' ? "La plus épaisse de la gamme, avec la même texture hyperréaliste que chaque feuille Foolish. Les deux faces identiques doublent la surface utile sans sacrifier la qualité d'entraînement." :
                loc === 'es' ? 'La más gruesa de la línea, con la misma textura hiperrealista de cada lámina Foolish. Las dos caras idénticas duplican la superficie útil sin sacrificar la calidad de entrenamiento.' :
                'Die dickste der Linie, mit derselben hyperrealistischen Textur wie jedes Foolish-Blatt. Zwei identische Seiten verdoppeln die Übungsfläche ohne Einbußen bei der Trainingsqualität.',
    description: loc === 'it' ? lexDescription(
      lexParagraph('Le pelli sottili mentono sulla profondità: non senti mai se stai scavando o accarezzando, e la memoria muscolare che ci costruisci sopra non si trasferisce sul cliente. Duoskin è la più spessa della linea: 6-8 mm. La macchinetta affonda contro una resistenza vera, il polso impara a dosare la profondità, e quello che impari qui lo ritrovi 1:1 sulla pelle del cliente.'),
      lexParagraph('Stesso standard Foolish: impasto fresco ogni giorno, colore a flock per discromie naturali, micropori, traslucenza, trasudazione e texture iperrealistica. Lo ritrovi su ogni prodotto della linea.'),
      lexParagraph('Due facce, stesso lavoro. Entrambi i lati sono identici — stessa texture, stesso spessore, stessa resa. Due skin complete in un foglio solo. Più ore di pratica, meno ordini da fare.', [{ text: 'Due facce, stesso lavoro.', bold: true }]),
      lexParagraph('— La macchinetta vibra contro resistenza: senti la profondità vera\n— I colori penetrano e si stratificano come su pelle umana\n— Lo stencil tiene e non scivola, dalla prima all\'ultima linea'),
      lexParagraph('Per chi fa ombre, color packing, blackwork e qualsiasi tecnica dove la profondità d\'ago decide il risultato.')
    ) : loc === 'en' ? lexDescription(
      lexParagraph("Thin skins lie about depth: you never know if you're digging or grazing, and the muscle memory you build on them doesn't transfer to a real client. Duoskin is the thickest in the line: 6-8 mm. The machine sinks against real resistance, your hand learns to modulate, and what you practice here carries 1:1 to real skin."),
      lexParagraph('Same Foolish standard: fresh silicone mix daily, flock coloring for natural dyschromia, micropores for stencil grip, translucency, transudation, hyperrealistic texture. Consistent across every product in the line.'),
      lexParagraph('Two faces, one job. Both sides are identical — same texture, same thickness, same performance. Two full practice skins in one sheet. More practice time, fewer orders.', [{ text: 'Two faces, one job.', bold: true }]),
      lexParagraph('— The machine vibrates against resistance: you feel true depth\n— Colors penetrate and layer like on human skin\n— The stencil holds from the first line to the last'),
      lexParagraph('For shading, color packing, blackwork, and any technique where needle depth is everything.')
    ) : loc === 'fr' ? lexDescription(
      lexParagraph("Les peaux fines mentent sur la profondeur : tu sais jamais si tu creuses ou si tu effleures, et la mémoire musculaire que tu construis dessus ne sert à rien sur un vrai client. Duoskin est la plus épaisse de la gamme : 6-8 mm. La machine s'enfonce contre une résistance réelle, ton poignet apprend à doser, et ce que tu pratiques ici tu le retrouves 1:1 sur la peau du client."),
      lexParagraph("Même standard Foolish : mélange frais chaque jour, couleur au flock pour les dyschromies naturelles, micropores, translucidité, transsudation, texture hyperréaliste. Identique sur tous les produits de la gamme."),
      lexParagraph("Deux faces, un seul boulot. Les deux côtés sont identiques — même texture, même épaisseur, même rendu. Deux peaux d'entraînement complètes dans une seule feuille. Plus d'heures de pratique, moins de commandes.", [{ text: 'Deux faces, un seul boulot.', bold: true }]),
      lexParagraph("— La machine vibre contre la résistance : tu sens la vraie profondeur\n— Les couleurs pénètrent et se stratifient comme sur la peau humaine\n— Le stencil tient du premier au dernier passage"),
      lexParagraph("Pour l'ombre, le color packing, le blackwork et toutes les techniques où la profondeur d'aiguille décide du résultat.")
    ) : loc === 'es' ? lexDescription(
      lexParagraph('Las pieles finas mienten sobre la profundidad: nunca sabes si estás cavando o rozando, y la memoria muscular que construyes sobre ellas no se transfiere a un cliente real. Duoskin es la más gruesa de la línea: 6-8 mm. La máquina se hunde contra resistencia real, tu mano aprende a dosificar, y lo que practicas aquí lo encuentras 1:1 en la piel del cliente.'),
      lexParagraph('Mismo estándar Foolish: mezcla fresca cada día, color con flock para discromías naturales, microporos, translucidez, transudación, textura hiperrealista. Consistente en todos los productos.'),
      lexParagraph('Dos caras, un mismo trabajo. Ambos lados son idénticos — misma textura, mismo grosor, mismo rendimiento. Dos pieles de práctica completas en una sola lámina. Más horas de práctica, menos pedidos.', [{ text: 'Dos caras, un mismo trabajo.', bold: true }]),
      lexParagraph('— La máquina vibra contra resistencia: sientes la profundidad real\n— Los colores penetran y se estratifican como en piel humana\n— El esténcil aguanta de la primera a la última línea'),
      lexParagraph('Para sombreado, color packing, blackwork y cualquier técnica donde la profundidad de aguja lo decide todo.')
    ) : lexDescription(
      lexParagraph("Dünne Häute lügen über die Tiefe: du weißt nie, ob du gräbst oder streichelst, und die Muskelmemory, die du darauf aufbaust, überträgt sich nicht auf echte Kunden. Duoskin ist die dickste der Linie: 6-8 mm. Die Maschine sinkt gegen echten Widerstand, deine Hand lernt dosieren, und was du hier übst, trägst du 1:1 auf echte Haut."),
      lexParagraph('Gleicher Foolish-Standard: frische Mischung täglich, Flock-Färbung für natürliche Dyschromie, Mikroporen, Transluzenz, Transsudation, hyperrealistische Textur. Konsistent in der ganzen Produktlinie.'),
      lexParagraph('Zwei Seiten, ein Job. Beide Seiten sind identisch — gleiche Textur, gleiche Stärke, gleiches Verhalten. Zwei komplette Übungshäute in einem Blatt. Mehr Übungsstunden, weniger Bestellungen.', [{ text: 'Zwei Seiten, ein Job.', bold: true }]),
      lexParagraph('— Die Maschine vibriert gegen Widerstand: du spürst die echte Tiefe\n— Farben dringen ein und schichten sich wie auf menschlicher Haut\n— Das Stencil hält von der ersten bis zur letzten Linie'),
      lexParagraph('Für Shading, Color Packing, Blackwork und jede Technik, bei der die Nadelstiefe alles entscheidet.')
    ),
    featureHighlights: [
      { icon: '📏', title: loc === 'it' ? 'Spessore 6-8mm' : loc === 'en' ? '6-8mm thickness' : loc === 'fr' ? 'Épaisseur 6-8mm' : loc === 'es' ? 'Grosor 6-8mm' : '6-8mm Stärke',
        description: loc === 'it' ? 'La più spessa della linea: resistenza vera che trasferisce la memoria muscolare al cliente' :
                      loc === 'en' ? 'The thickest in the line: true resistance that transfers muscle memory to real clients' :
                      loc === 'fr' ? "La plus épaisse : résistance réelle qui transfère la mémoire musculaire au client" :
                      loc === 'es' ? 'La más gruesa: resistencia real que transfiere la memoria muscular al cliente' :
                      'Die dickste der Linie: echter Widerstand, der Muskelmemory auf echte Kunden überträgt' },
      { icon: '🔄', title: loc === 'it' ? 'Due facce identiche' : loc === 'en' ? 'Two identical faces' : loc === 'fr' ? 'Deux faces identiques' : loc === 'es' ? 'Dos caras idénticas' : 'Zwei identische Seiten',
        description: loc === 'it' ? 'Stessa texture su entrambi i lati: due skin complete in un foglio solo' :
                      loc === 'en' ? 'Same texture on both sides: two full skins in one sheet' :
                      loc === 'fr' ? 'Même texture des deux côtés : deux peaux en une seule feuille' :
                      loc === 'es' ? 'Misma textura en ambos lados: dos pieles en una sola lámina' :
                      'Gleiche Textur auf beiden Seiten: zwei Häute in einem Blatt' },
      { icon: '🎯', title: loc === 'it' ? 'Feedback ago profondo' : loc === 'en' ? 'Deep needle feedback' : loc === 'fr' ? "Retour d'aiguille profond" : loc === 'es' ? 'Feedback de aguja profundo' : 'Tiefes Nadel-Feedback',
        description: loc === 'it' ? 'La macchinetta vibra contro resistenza, impari a dosare la profondità' :
                      loc === 'en' ? 'The machine vibrates against resistance, teaching you to modulate depth' :
                      loc === 'fr' ? 'La machine vibre contre la résistance, tu apprends à doser la profondeur' :
                      loc === 'es' ? 'La máquina vibra contra resistencia, aprendes a dosificar la profundidad' :
                      'Die Maschine vibriert gegen Widerstand, du lernst die Tiefe zu dosieren' },
      { icon: '🎨', title: loc === 'it' ? 'Colori stratificati' : loc === 'en' ? 'Layered color' : loc === 'fr' ? 'Couleurs stratifiées' : loc === 'es' ? 'Colores estratificados' : 'Farbschichtung',
        description: loc === 'it' ? 'I pigmenti penetrano e si comportano come su pelle umana' :
                      loc === 'en' ? 'Pigments penetrate and behave like on human skin' :
                      loc === 'fr' ? 'Les pigments pénètrent comme sur la peau humaine' :
                      loc === 'es' ? 'Los pigmentos penetran como en piel humana' :
                      'Pigmente dringen ein und verhalten sich wie auf menschlicher Haut' }
    ],
    usageSteps: [
      { step: 1, title: loc === 'it' ? 'Prepara' : loc === 'en' ? 'Prep' : loc === 'fr' ? 'Prépare' : loc === 'es' ? 'Prepara' : 'Vorbereiten',
        description: loc === 'it' ? 'Sgrassalo con alcol, applica lo stencil, attendi 15 minuti' : loc === 'en' ? 'Wipe with alcohol, apply stencil, wait 15 minutes' : loc === 'fr' ? "Nettoie à l'alcool, applique le stencil, attends 15 minutes" : loc === 'es' ? 'Limpia con alcohol, aplica el esténcil, espera 15 minutos' : 'Mit Alkohol reinigen, Stencil auftragen, 15 Minuten warten' },
      { step: 2, title: loc === 'it' ? 'Lavora' : loc === 'en' ? 'Work' : loc === 'fr' ? 'Travaille' : loc === 'es' ? 'Trabaja' : 'Arbeiten',
        description: loc === 'it' ? 'Tatua sul primo lato, poi utilizza il secondo per un altro esercizio o tecnica' : loc === 'en' ? 'Tattoo the first side, then use the second for another exercise or technique' : loc === 'fr' ? 'Tatoue le premier côté, puis utilise le second pour un autre exercice' : loc === 'es' ? 'Tatúa el primer lado, luego usa el segundo para otro ejercicio o técnica' : 'Erste Seite tätowieren, dann zweite Seite für eine andere Übung nutzen' },
      { step: 3, title: loc === 'it' ? 'Verifica' : loc === 'en' ? 'Check' : loc === 'fr' ? 'Vérifie' : loc === 'es' ? 'Verifica' : 'Prüfen',
        description: loc === 'it' ? 'Controlla saturazione, profondità e tenuta del colore su entrambi i lati' : loc === 'en' ? 'Review saturation, depth, and color hold on both sides' : loc === 'fr' ? 'Contrôle saturation, profondeur et tenue de la couleur sur les deux faces' : loc === 'es' ? 'Revisa saturación, profundidad y retención del color en ambos lados' : 'Sättigung, Tiefe und Farbehalt auf beiden Seiten kontrollieren' }
    ],
    whatsInTheBox: loc === 'it' ? ['Foglio singolo Duoskin', 'Busta richiudibile per conservazione', 'Scheda prodotto con codici lotto e data produzione'] : loc === 'en' ? ['Single Duoskin sheet', 'Resealable storage pouch', 'Product card with batch code and production date'] : loc === 'fr' ? ['Feuille unique Duoskin', 'Pochette refermable', 'Fiche produit avec code lot et date de production'] : loc === 'es' ? ['Lámina individual Duoskin', 'Bolsa reutilizable', 'Tarjeta de producto con código de lote y fecha de producción'] : ['Einzelblatt Duoskin', 'Wiederverschließbare Tasche', 'Produktkarte mit Chargencode und Herstellungsdatum']
  }
}

// --- ALEX'S HAND ---
DATA['alexs-hand'] = {}
for (const loc of LOCALES) {
  DATA['alexs-hand'][loc] = {
    shortDescription: loc === 'it' ? 'Mano iperrealistica scolpita a mano, unica. Se sai tatuare una mano, sai tatuare tutto.' :
                       loc === 'en' ? "Hand-sculpted hyperrealistic silicone hand, each one unique. Master a hand, master it all." :
                       loc === 'fr' ? "Main hyperréaliste sculptée à la main, pièce unique. Savoir tatouer une main, c'est tout savoir." :
                       loc === 'es' ? 'Mano hiperrealista esculpida a mano, única. Saber tatuar una mano es saberlo todo.' :
                       'Handgeformte hyperrealistische Silikonhand, jedes Stück ein Unikat. Wer eine Hand tätowieren kann, kann alles tätowieren.',
    uniqueNote: loc === 'it' ? "Stampata da un calco reale, ritoccata e rifinita a mano. Ogni mano è un pezzo unico — non esiste in serie. Venature, pori e tensione della pelle riprodotti come su una mano vera." :
                loc === 'en' ? "Cast from a real mold, hand-retouched and finished. Each hand is a unique piece — never mass-produced. Veins, pores, and skin tension replicated like the real thing." :
                loc === 'fr' ? "Moulée sur une main réelle, retouchée et finie à la main. Chaque pièce est unique — pas de production en série. Veines, pores et tension de la peau reproduits comme sur une vraie main." :
                loc === 'es' ? "Moldeada de una mano real, retocada y acabada a mano. Cada pieza es única — no hay producción en serie. Venas, poros y tensión de la piel reproducidos como en una mano real." :
                "Von einem echten Abdruck gegossen, nachbearbeitet und von Hand vollendet. Jedes Stück ist ein Unikat — keine Massenproduktion. Adern, Poren und Hautspannung wie an einer echten Hand.",
    description: loc === 'it' ? lexDescription(
      lexParagraph('Un foglio è piatto. La mano di un cliente è tutto: curve, nocche, tendini, spazi tra le dita, il dorso che cambia angolo a ogni movimento. Se sai tatuare una mano, sai tatuare tutto.'),
      lexParagraph("Alex's Hand nasce da uno stampo reale, ritoccata e rifinita a mano. Ogni pezzo è unico — non ce n'è una uguale all'altra. Il silicone riproduce la densità e la tensione della pelle vera, con pori, venature e texture che solo un lavoro artigianale può dare."),
      lexParagraph('Non è solo pratica. È esposizione. La finitura è talmente curata che puoi esporla in studio, portarla in fiera o fotografarla per il portfolio. I tuoi lavori non stanno su un foglio piegato — stanno su una mano.', [{ text: 'Non è solo pratica. È esposizione.', bold: true }]),
      lexParagraph('Ogni dettaglio è lì per metterti alla prova.')
    ) : loc === 'en' ? lexDescription(
      lexParagraph("A sheet is flat. A client's hand is everything: curves, knuckles, tendons, the gaps between fingers, the back of the hand shifting angle with every movement. If you can tattoo a hand, you can tattoo anything."),
      lexParagraph("Alex's Hand is cast from a real mold, then retouched and hand-finished. Every piece is unique — no two hands come out the same. The silicone replicates the density and tension of real skin, with pores, veins, and a texture that only handcraft can deliver."),
      lexParagraph('Not just practice. Display. The finish is so good you can exhibit it in your studio, take it to conventions, or shoot it for your portfolio. Your work doesn\'t live on a folded sheet — it lives on a hand.', [{ text: 'Not just practice. Display.', bold: true }]),
      lexParagraph('Every detail is there to push your skill.')
    ) : loc === 'fr' ? lexDescription(
      lexParagraph("Une feuille, c'est plat. La main d'un client, c'est tout le reste : courbes, phalanges, tendons, les espaces entre les doigts, le dos qui change d'angle à chaque mouvement. Si tu sais tatouer une main, tu sais tout tatouer."),
      lexParagraph("Alex's Hand est moulée sur une main réelle, puis retouchée et finie à la main. Chaque pièce est unique — il n'y a pas deux mains identiques. Le silicone reproduit la densité et la tension de la vraie peau, avec des pores, des veines et une texture que seul l'artisanat peut donner."),
      lexParagraph("Pas que pour l'entraînement. Pour l'expo. La finition est telle que tu peux l'exposer en studio, l'emmener en convention ou la shooter pour ton portfolio. Ton travail ne vit pas sur une feuille pliée — il vit sur une main.", [{ text: "Pas que pour l'entraînement. Pour l'expo.", bold: true }]),
      lexParagraph('Chaque détail est là pour te pousser à te dépasser.')
    ) : loc === 'es' ? lexDescription(
      lexParagraph('Una lámina es plana. La mano de un cliente lo es todo: curvas, nudillos, tendones, los espacios entre los dedos, el dorso que cambia de ángulo con cada movimiento. Si sabes tatuar una mano, sabes tatuarlo todo.'),
      lexParagraph("Alex's Hand está moldeada de una mano real, retocada y acabada a mano. Cada pieza es única — no hay dos manos iguales. La silicona reproduce la densidad y tensión de la piel real, con poros, venas y una textura que solo la artesanía puede dar."),
      lexParagraph('No es solo práctica. Es exposición. El acabado es tan bueno que puedes exhibirla en tu estudio, llevarla a convenciones o fotografiarla para tu portfolio. Tu trabajo no vive en una lámina doblada — vive en una mano.', [{ text: 'No es solo práctica. Es exposición.', bold: true }]),
      lexParagraph('Cada detalle está ahí para ponerte a prueba.')
    ) : lexDescription(
      lexParagraph('Ein Blatt ist flach. Die Hand eines Kunden ist alles: Kurven, Knöchel, Sehnen, die Zwischenräume der Finger, der Handrücken, der bei jeder Bewegung den Winkel wechselt. Wer eine Hand tätowieren kann, kann alles tätowieren.'),
      lexParagraph("Alex's Hand wird von einem echten Abdruck gegossen, nachbearbeitet und von Hand vollendet. Jedes Stück ist ein Unikat — keine zwei Hände sind gleich. Das Silikon reproduziert die Dichte und Spannung echter Haut mit Poren, Adern und einer Textur, die nur Handwerkskunst liefern kann."),
      lexParagraph('Nicht nur Übung. Ausstellung. Die Verarbeitung ist so gut, dass du sie im Studio ausstellen, auf Messen mitnehmen oder für dein Portfolio fotografieren kannst. Deine Arbeit lebt nicht auf einem gefalteten Blatt — sie lebt auf einer Hand.', [{ text: 'Nicht nur Übung. Ausstellung.', bold: true }]),
      lexParagraph('Jedes Detail ist da, um dich zu fordern.')
    ),
    featureHighlights: [
      { icon: '✋', title: loc === 'it' ? 'Calco da mano reale' : loc === 'en' ? 'Real hand cast' : loc === 'fr' ? 'Moulage main réelle' : loc === 'es' ? 'Molde mano real' : 'Echter Handabdruck',
        description: loc === 'it' ? "Stampata da un calco vero, riproduce curve, nocche, tendini e spazi tra le dita" : loc === 'en' ? 'Cast from an actual hand mold: curves, knuckles, tendons, and finger gaps' : loc === 'fr' ? "Moulée sur une vraie main : courbes, phalanges, tendons, espaces interdigitaux" : loc === 'es' ? 'Moldeada de una mano real: curvas, nudillos, tendones, espacios entre dedos' : 'Von einer echten Hand gegossen: Kurven, Knöchel, Sehnen, Fingerzwischenräume' },
      { icon: '🔧', title: loc === 'it' ? 'Ritoccata a mano' : loc === 'en' ? 'Hand-finished' : loc === 'fr' ? 'Finie à la main' : loc === 'es' ? 'Acabada a mano' : 'Handverarbeitet',
        description: loc === 'it' ? "Ogni pezzo è rifinito artigianalmente, nessuna mano è uguale all'altra" : loc === 'en' ? 'Every piece is individually refined, no two hands are the same' : loc === 'fr' ? 'Chaque pièce est retouchée individuellement, deux mains ne sont jamais identiques' : loc === 'es' ? 'Cada pieza se retoca individualmente, no hay dos manos iguales' : 'Jedes Stück wird einzeln veredelt, keine zwei Hände sind gleich' },
      { icon: '🏆', title: loc === 'it' ? 'Esposizione e portfolio' : loc === 'en' ? 'Display & portfolio' : loc === 'fr' ? 'Exposition & portfolio' : loc === 'es' ? 'Exposición y portfolio' : 'Ausstellung & Portfolio',
        description: loc === 'it' ? 'Finitura museale: esponila in studio, portala in fiera, fotografala per il portfolio' : loc === 'en' ? 'Gallery-quality finish: exhibit in your studio, take to conventions, or photograph' : loc === 'fr' ? "Fini musée : expose-la en studio, emmène-la en convention, shoote-la pour ton book" : loc === 'es' ? 'Acabado de museo: exhibe en estudio, lleva a convenciones, fotografía para tu book' : 'Museumsqualität: ausstellen im Studio, mitnehmen auf Messen, fotografieren fürs Portfolio' },
      { icon: '🧪', title: loc === 'it' ? 'Silicone iperrealistico' : loc === 'en' ? 'Hyperrealistic silicone' : loc === 'fr' ? 'Silicone hyperréaliste' : loc === 'es' ? 'Silicona hiperrealista' : 'Hyperrealistisches Silikon',
        description: loc === 'it' ? 'Densità e tensione come sulla pelle vera, con pori e venature' : loc === 'en' ? 'Density and tension like real skin, with pores and veins' : loc === 'fr' ? 'Densité et tension comme sur la vraie peau, avec pores et veines' : loc === 'es' ? 'Densidad y tensión como en piel real, con poros y venas' : 'Dichte und Spannung wie echte Haut, mit Poren und Adern' }
    ],
    usageSteps: [
      { step: 1, title: loc === 'it' ? 'Prepara' : loc === 'en' ? 'Prep' : loc === 'fr' ? 'Prépare' : loc === 'es' ? 'Prepara' : 'Vorbereiten',
        description: loc === 'it' ? 'Fissa la mano sul supporto da tavolo incluso, sgrassa con alcol' : loc === 'en' ? 'Mount on the included table stand, wipe with alcohol' : loc === 'fr' ? "Fixe la main sur le support de table inclus, nettoie à l'alcool" : loc === 'es' ? 'Fija la mano en el soporte de mesa incluido, limpia con alcohol' : 'Hand auf dem beiliegenden Tischständer montieren, mit Alkohol reinigen' },
      { step: 2, title: loc === 'it' ? 'Tatua' : loc === 'en' ? 'Tattoo' : loc === 'fr' ? 'Tatoue' : loc === 'es' ? 'Tatúa' : 'Tätowieren',
        description: loc === 'it' ? 'Lavora su diverse zone: dorso, nocche, dita, palmo — ognuna con angolazione e tensione diverse' : loc === 'en' ? 'Work different areas: back of hand, knuckles, fingers, palm — each with unique angle and tension' : loc === 'fr' ? "Travaille différentes zones : dos, phalanges, doigts, paume — angles et tensions variés" : loc === 'es' ? 'Trabaja diferentes zonas: dorso, nudillos, dedos, palma — cada una con distinto ángulo y tensión' : 'Verschiedene Zonen bearbeiten: Handrücken, Knöchel, Finger, Handfläche — unterschiedliche Winkel und Spannungen' },
      { step: 3, title: loc === 'it' ? 'Esponi' : loc === 'en' ? 'Display' : loc === 'fr' ? 'Expose' : loc === 'es' ? 'Exhibe' : 'Ausstellen',
        description: loc === 'it' ? 'Rimonta la mano sullo stand e presentala in studio o fotografala per il portfolio' : loc === 'en' ? 'Remount on display stand for studio exhibition or portfolio photography' : loc === 'fr' ? 'Remonte sur le présentoir pour exposition en studio ou photo portfolio' : loc === 'es' ? 'Vuelve a montar en el soporte para exposición en estudio o foto de portfolio' : 'Auf dem Präsentationsständer für Studioausstellung oder Portfoliofotos montieren' }
    ],
    whatsInTheBox: loc === 'it' ? ["Alex's Hand in silicone iperrealistico", 'Supporto da tavolo per pratica', 'Stand per esposizione', 'Scheda prodotto con numero di pezzo'] :
                   loc === 'en' ? ["Alex's Hand hyperrealistic silicone", 'Practice table stand', 'Display stand', 'Product card with piece number'] :
                   loc === 'fr' ? ['Main Alex\'s Hand silicone hyperréaliste', 'Support de table pour pratique', 'Présentoir', 'Fiche produit avec numéro de pièce'] :
                   loc === 'es' ? ['Mano Alex\'s Hand silicona hiperrealista', 'Soporte de mesa para práctica', 'Soporte de exposición', 'Tarjeta de producto con número de pieza'] :
                   ["Alex's Hand hyperrealistisches Silikon", 'Tischständer für Übungen', 'Ausstellungsständer', 'Produktkarte mit Stücknummer']
  }
}

// P-3D FACE KIT
DATA['p-3d-skin-face-starter-kit'] = {}
for (const loc of LOCALES) {
  DATA['p-3d-skin-face-starter-kit'][loc] = {
    shortDescription: loc === 'it' ? 'Sistema completo per PMU training: volto 3D, supporto cranico e stand esposizione incluso.' :
                       loc === 'en' ? 'Complete PMU training system: 3D silicone face, head support, and display stand included.' :
                       loc === 'fr' ? 'Système complet pour formation PMU : visage 3D, support crânien et présentoir inclus.' :
                       loc === 'es' ? 'Sistema completo para formación PMU: rostro 3D, soporte craneal y soporte de exposición incluido.' :
                       'Komplettes PMU-Trainingssystem: 3D-Silikongesicht, Kopfstütze und Ausstellungsständer inklusive.',
    uniqueNote: loc === 'it' ? 'Un sistema completo pensato con trainer PMU reali. Il silicone riproduce la densità specifica della pelle del viso — diversa da quella del corpo — per un training fedele al tatto del cliente.' :
                loc === 'en' ? 'A complete system designed with real PMU trainers. The silicone replicates the specific density of facial skin — different from body skin — for training that feels right.' :
                loc === 'fr' ? "Un système complet conçu avec des formateurs PMU réels. Le silicone reproduit la densité spécifique de la peau du visage — différente de celle du corps — pour un entraînement au toucher réaliste." :
                loc === 'es' ? 'Un sistema completo diseñado con formadores PMU reales. La silicona replica la densidad específica de la piel facial — diferente de la corporal — para un entrenamiento con tacto realista.' :
                'Ein komplettes System, entwickelt mit echten PMU-Trainern. Das Silikon repliziert die spezifische Dichte der Gesichtshaut — anders als Körperhaut — für ein realistisches Trainingsgefühl.',
    description: loc === 'it' ? lexDescription(
      lexParagraph("Il trucco permanente si impara su un viso, non su un foglio piatto. Le proporzioni, la simmetria, la tensione della pelle che cambia da fronte a zigomi a labbra — un foglio non te le dà. Questo kit sì."),
      lexParagraph("Il P-3D Skin Face Starter Kit è un sistema di training completo: un volto 3D in silicone iperrealistico con proporzioni facciali reali, supporto con volume cranico che si aggancia al tavolo (come un manichino), e stand per esposizione."),
      lexParagraph('Non solo microblading. Sopracciglia, labbra, eyeliner, trucco permanente, face tattoo: qualsiasi tecnica trova la resistenza e l\'angolazione giusta.', [{ text: 'Non solo microblading.', bold: true }]),
      lexParagraph('Supporto incluso. La testa resta ferma mentre lavori. E quando hai finito, la monti sullo stand e la presenti.', [{ text: 'Supporto incluso.', bold: true }]),
      lexParagraph("Il primo viso su cui non puoi sbagliare.")
    ) : loc === 'en' ? lexDescription(
      lexParagraph('Permanent makeup is learned on a face, not on a flat sheet. Proportions, symmetry, skin tension changing from forehead to cheekbones to lips — a flat sheet can\'t give you that. This kit can.'),
      lexParagraph('The P-3D Skin Face Starter Kit is a complete training system: a 3D hyperrealistic silicone face with real facial proportions, a head-volume support that anchors to the table (mannequin-style), and a display stand.'),
      lexParagraph('Not just microblading. Brows, lips, eyeliner, permanent makeup, face tattoo — every technique finds the right resistance and angle.', [{ text: 'Not just microblading.', bold: true }]),
      lexParagraph('Support included. The head stays steady while you work. And when you\'re done, mount it on the stand and present it.', [{ text: 'Support included.', bold: true }]),
      lexParagraph("The first face you can't mess up.")
    ) : loc === 'fr' ? lexDescription(
      lexParagraph("Le maquillage permanent s'apprend sur un visage, pas sur une feuille plate. Les proportions, la symétrie, la tension de la peau qui change du front aux pommettes aux lèvres — une feuille ne peut pas te donner ça. Ce kit le peut."),
      lexParagraph("Le P-3D Skin Face Starter Kit est un système d'entraînement complet : un visage 3D en silicone hyperréaliste avec des proportions faciales réelles, un support avec volume crânien qui s'ancre à la table (façon mannequin), et un présentoir."),
      lexParagraph('Pas que du microblading. Sourcils, lèvres, eye-liner, maquillage permanent, face tattoo — chaque technique trouve la bonne résistance et le bon angle.', [{ text: 'Pas que du microblading.', bold: true }]),
      lexParagraph('Support inclus. La tête reste stable pendant que tu travailles. Et quand t\'as fini, tu la montes sur le présentoir.', [{ text: 'Support inclus.', bold: true }]),
      lexParagraph("Le premier visage sur lequel tu peux pas te planter.")
    ) : loc === 'es' ? lexDescription(
      lexParagraph('El maquillaje permanente se aprende en un rostro, no en una lámina plana. Las proporciones, la simetría, la tensión de la piel que cambia de la frente a los pómulos a los labios — una lámina no te lo da. Este kit sí.'),
      lexParagraph('El P-3D Skin Face Starter Kit es un sistema de entrenamiento completo: un rostro 3D en silicona hiperrealista con proporciones faciales reales, un soporte con volumen craneal que se ancla a la mesa (tipo maniquí), y un soporte para exposición.'),
      lexParagraph('No solo microblading. Cejas, labios, delineador, maquillaje permanente, face tattoo — cada técnica encuentra la resistencia y el ángulo correcto.', [{ text: 'No solo microblading.', bold: true }]),
      lexParagraph('Soporte incluido. La cabeza se mantiene firme mientras trabajas. Y cuando terminas, la montas en el soporte y la presentas.', [{ text: 'Soporte incluido.', bold: true }]),
      lexParagraph('El primer rostro en el que no puedes equivocarte.')
    ) : lexDescription(
      lexParagraph('Permanent Make-up lernt man auf einem Gesicht, nicht auf einem flachen Blatt. Proportionen, Symmetrie, Hautspannung, die sich von der Stirn über die Wangenknochen zu den Lippen verändert — ein Blatt kann dir das nicht geben. Dieses Kit schon.'),
      lexParagraph('Das P-3D Skin Face Starter Kit ist ein komplettes Trainingssystem: ein 3D hyperrealistisches Silikongesicht mit echten Gesichtsproportionen, einer Kopfstütze mit Schädelvolumen, die auf dem Tisch verankert wird (Schaufensterpuppen-Stil), und einem Ausstellungsständer.'),
      lexParagraph('Nicht nur Microblading. Augenbrauen, Lippen, Eyeliner, Permanent Make-up, Face Tattoo — jede Technik findet den richtigen Widerstand und Winkel.', [{ text: 'Nicht nur Microblading.', bold: true }]),
      lexParagraph('Stütze inklusive. Der Kopf bleibt stabil während der Arbeit. Und wenn du fertig bist, montierst du ihn auf den Ständer und präsentierst ihn.', [{ text: 'Stütze inklusive.', bold: true }]),
      lexParagraph('Das erste Gesicht, an dem du nichts falsch machen kannst.')
    ),
    featureHighlights: [
      { icon: '🧑', title: loc === 'it' ? 'Volto 3D iperrealistico' : loc === 'en' ? 'Hyperrealistic 3D face' : loc === 'fr' ? 'Visage 3D hyperréaliste' : loc === 'es' ? 'Rostro 3D hiperrealista' : '3D hyperrealistisches Gesicht',
        description: loc === 'it' ? 'Proporzioni facciali reali, non un foglio piatto: simmetria, fronte, zigomi, labbra' : loc === 'en' ? 'Real facial proportions: symmetry, forehead, cheekbones, lips — not a flat sheet' : loc === 'fr' ? "Proportions faciales réelles : symétrie, front, pommettes, lèvres — pas une feuille plate" : loc === 'es' ? 'Proporciones faciales reales: simetría, frente, pómulos, labios — no una lámina plana' : 'Echte Gesichtsproportionen: Symmetrie, Stirn, Wangenknochen, Lippen — kein flaches Blatt' },
      { icon: '🔩', title: loc === 'it' ? 'Supporto cranico incluso' : loc === 'en' ? 'Head support included' : loc === 'fr' ? 'Support crânien inclus' : loc === 'es' ? 'Soporte craneal incluido' : 'Kopfstütze inklusive',
        description: loc === 'it' ? "Si aggancia al tavolo come un manichino: lavori con la testa ferma e stabile" : loc === 'en' ? 'Anchors to the table mannequin-style: stable while you work' : loc === 'fr' ? "S'ancre à la table façon mannequin : stable pendant le travail" : loc === 'es' ? 'Se ancla a la mesa tipo maniquí: estable mientras trabajas' : 'Wird mannequinartig am Tisch verankert: stabil während der Arbeit' },
      { icon: '🖼️', title: loc === 'it' ? 'Stand esposizione' : loc === 'en' ? 'Display stand' : loc === 'fr' ? 'Présentoir' : loc === 'es' ? 'Soporte de exposición' : 'Ausstellungsständer',
        description: loc === 'it' ? 'Monta il viso sullo stand per presentare il tuo lavoro a corsi, fiere o clienti' : loc === 'en' ? 'Mount the face on the stand to present your work at courses, conventions, or to clients' : loc === 'fr' ? "Monte le visage sur le présentoir pour exposer ton travail en cours, conventions ou aux clients" : loc === 'es' ? 'Monta el rostro para presentar tu trabajo en cursos, convenciones o a clientes' : 'Gesicht für Präsentation auf Kursen, Messen oder bei Kunden montieren' },
      { icon: '🎯', title: loc === 'it' ? 'Pelle viso specifica' : loc === 'en' ? 'Facial-specific skin' : loc === 'fr' ? 'Peau visage spécifique' : loc === 'es' ? 'Piel facial específica' : 'Gesichtsspezifische Haut',
        description: loc === 'it' ? 'Silicone studiato per replicare la densità della pelle del viso, diversa da quella corporea' : loc === 'en' ? 'Silicone formulated to replicate facial skin density, different from body skin' : loc === 'fr' ? "Silicone formulé pour la densité de la peau du visage, différent de la peau corporelle" : loc === 'es' ? 'Silicona formulada para la densidad de la piel facial, diferente de la corporal' : 'Silikon formuliert für die Dichte der Gesichtshaut, anders als Körperhaut' }
    ],
    usageSteps: [
      { step: 1, title: loc === 'it' ? 'Monta' : loc === 'en' ? 'Mount' : loc === 'fr' ? 'Monte' : loc === 'es' ? 'Monta' : 'Montieren',
        description: loc === 'it' ? 'Fissa il supporto cranico al tavolo, aggancia il volto 3D' : loc === 'en' ? 'Attach the head support to the table, connect the 3D face' : loc === 'fr' ? "Fixe le support crânien à la table, connecte le visage 3D" : loc === 'es' ? 'Fija el soporte craneal a la mesa, conecta el rostro 3D' : 'Kopfstütze am Tisch befestigen, 3D-Gesicht anschließen' },
      { step: 2, title: loc === 'it' ? 'Lavora' : loc === 'en' ? 'Work' : loc === 'fr' ? 'Travaille' : loc === 'es' ? 'Trabaja' : 'Arbeiten',
        description: loc === 'it' ? "Esercitati su sopracciglia, labbra, eyeliner, face tattoo — ogni zona ha angolazione e resistenza diverse" : loc === 'en' ? 'Practice on brows, lips, eyeliner, face tattoo — each area has different angle and resistance' : loc === 'fr' ? "Entraîne-toi sur sourcils, lèvres, eye-liner, face tattoo — chaque zone a son angle et sa résistance" : loc === 'es' ? 'Practica en cejas, labios, delineador, face tattoo — cada zona con distinto ángulo y resistencia' : 'Üben an Augenbrauen, Lippen, Eyeliner, Face Tattoo — jeder Bereich mit eigenem Winkel und Widerstand' },
      { step: 3, title: loc === 'it' ? 'Presenta' : loc === 'en' ? 'Present' : loc === 'fr' ? 'Présente' : loc === 'es' ? 'Presenta' : 'Präsentieren',
        description: loc === 'it' ? "Sgancia il volto dallo stand da tavolo e montalo sul supporto esposizione incluso" : loc === 'en' ? 'Detach from table stand and mount on the included display stand' : loc === 'fr' ? "Détache du support de table et monte sur le présentoir inclus" : loc === 'es' ? 'Desmonta del soporte de mesa y monta en el soporte de exposición incluido' : 'Vom Tischständer lösen und auf dem beiliegenden Ausstellungsständer montieren' }
    ],
    whatsInTheBox: loc === 'it' ? ['Volto 3D in silicone iperrealistico', 'Supporto cranico con aggancio da tavolo', 'Stand per esposizione', 'Scheda prodotto'] :
                   loc === 'en' ? ['3D hyperrealistic silicone face', 'Head support with table clamp', 'Display stand', 'Product card'] :
                   loc === 'fr' ? ['Visage 3D silicone hyperréaliste', 'Support crânien avec fixation table', 'Présentoir', 'Fiche produit'] :
                   loc === 'es' ? ['Rostro 3D silicona hiperrealista', 'Soporte craneal con fijación de mesa', 'Soporte de exposición', 'Tarjeta de producto'] :
                   ['3D hyperrealistisches Silikongesicht', 'Kopfstütze mit Tischklemme', 'Ausstellungsständer', 'Produktkarte']
  }
}

// --- ROTOLO B2B ---
DATA['t-sheet-dbl-roll'] = {}
for (const loc of LOCALES) {
  DATA['t-sheet-dbl-roll'][loc] = {
    shortDescription: loc === 'it' ? 'Rotolo T-Sheet DBL per scuole. La stessa qualità Foolish, tagliata su misura per i tuoi studenti.' :
                       loc === 'en' ? 'T-Sheet DBL roll for schools. Same Foolish quality, cut to size for your students.' :
                       loc === 'fr' ? "Rouleau T-Sheet DBL pour écoles. La même qualité Foolish, coupée sur mesure pour tes élèves." :
                       loc === 'es' ? 'Rollo T-Sheet DBL para escuelas. La misma calidad Foolish, cortada a medida para tus estudiantes.' :
                       'T-Sheet DBL Rolle für Schulen. Dieselbe Foolish-Qualität, zugeschnitten für deine Schüler.',
    uniqueNote: loc === 'it' ? "La stessa identica pelle dei fogli singoli, nel formato più conveniente per chi forma. Nessuna differenza tra quello che usi in aula e quello che i tuoi studenti troveranno dopo il corso." :
                loc === 'en' ? "The exact same skin as our single sheets, in the most cost-effective format for educators. Zero difference between what you use in class and what students will find after the course." :
                loc === 'fr' ? "La même peau exactement que nos feuilles individuelles, dans le format le plus économique pour les formateurs. Zéro différence entre ce que tu utilises en cours et ce que les élèves trouveront après la formation." :
                loc === 'es' ? "La misma piel exacta que nuestras láminas individuales, en el formato más económico para formadores. Cero diferencia entre lo que usas en clase y lo que los estudiantes encontrarán después del curso." :
                'Dieselbe Haut wie unsere Einzelblätter, im kostengünstigsten Format für Ausbilder. Null Unterschied zwischen dem, was du im Unterricht verwendest, und dem, was die Schüler nach dem Kurs vorfinden.',
    description: loc === 'it' ? lexDescription(
      lexParagraph("Per insegnare tatuaggio hai bisogno di due cose: consistenza tra uno studente e l'altro, e un costo che tenga conto dei volumi. Il Rotolo T-Sheet DBL ti dà entrambe."),
      lexParagraph('Stessa pelle bifacciale 4mm dei fogli singoli: impasto fresco ogni giorno, flock per discromie naturali, micropori per lo stencil, traslucenza per leggere l\'inchiostro vero, texture iperrealistica. Zero differenza tra quello che usi in aula e quello che i tuoi studenti troveranno dopo il corso.'),
      lexParagraph('Taglia quello che serve. Il rotolo ti permette di dosare il materiale per studente senza sprechi. Un formato pensato per chi forma, non per chi pratica da solo.', [{ text: 'Taglia quello che serve.', bold: true }]),
      lexParagraph('Per scuole di tatuaggio, corsi professionali e formatori che vogliono il meglio per i loro studenti senza sprechi e sorprese.')
    ) : loc === 'en' ? lexDescription(
      lexParagraph('Teaching tattooing takes two things: consistency across every student, and a cost that works at volume. The T-Sheet DBL Roll gives you both.'),
      lexParagraph('Same 4mm double-sided skin as the single sheets: fresh silicone mix daily, flock coloring for natural dyschromia, micropores for stencil grip, translucency for true ink reading, hyperrealistic texture. Zero difference between what you use in class and what your students will use after the course.'),
      lexParagraph('Cut what you need. The roll lets you portion material per student with zero waste. A format designed for educators, not solo practitioners.', [{ text: 'Cut what you need.', bold: true }]),
      lexParagraph('For tattoo schools, professional courses, and educators who want the best for their students without waste or surprises.')
    ) : loc === 'fr' ? lexDescription(
      lexParagraph("Pour enseigner le tatouage, t'as besoin de deux choses : la constance entre chaque élève, et un coût qui tienne compte des volumes. Le Rouleau T-Sheet DBL te donne les deux."),
      lexParagraph('Même peau biface 4mm que les feuilles individuelles : mélange silicone frais chaque jour, flock pour les dyschromies naturelles, micropores pour le stencil, translucidité pour lire l\'encre vraie, texture hyperréaliste. Zéro différence entre ce que tu utilises en cours et ce que tes élèves trouveront après la formation.'),
      lexParagraph("Tu coupes ce qu'il faut. Le rouleau te permet de distribuer le matériel par élève sans gaspillage. Un format pensé pour les formateurs, pas pour les solitaires.", [{ text: "Tu coupes ce qu'il faut.", bold: true }]),
      lexParagraph("Pour les écoles de tatouage, cours professionnels et formateurs qui veulent le meilleur pour leurs élèves sans gaspillage ni surprises.")
    ) : loc === 'es' ? lexDescription(
      lexParagraph('Para enseñar tatuaje necesitas dos cosas: consistencia entre cada estudiante, y un costo que funcione con volúmenes. El Rollo T-Sheet DBL te da ambas.'),
      lexParagraph('La misma piel bifacial 4mm que las láminas individuales: mezcla de silicona fresca cada día, flock para discromías naturales, microporos para el esténcil, translucidez para leer la tinta real, textura hiperrealista. Cero diferencia entre lo que usas en clase y lo que tus estudiantes encontrarán después del curso.'),
      lexParagraph('Corta lo que necesitas. El rollo te permite dosificar el material por estudiante sin desperdicio. Un formato pensado para formadores, no para quien practica solo.', [{ text: 'Corta lo que necesitas.', bold: true }]),
      lexParagraph('Para escuelas de tatuaje, cursos profesionales y formadores que quieren lo mejor para sus estudiantes sin desperdicios ni sorpresas.')
    ) : lexDescription(
      lexParagraph('Tätowieren zu unterrichten braucht zwei Dinge: Konsistenz zwischen jedem Schüler und einen Kostenpunkt, der bei Volumen funktioniert. Die T-Sheet DBL Rolle gibt dir beides.'),
      lexParagraph('Dieselbe 4mm doppelseitige Haut wie die Einzelblätter: frische Silikonmischung täglich, Flock-Färbung für natürliche Dyschromie, Mikroporen für Stencil-Haftung, Transluzenz für echte Tintenablesung, hyperrealistische Textur. Null Unterschied zwischen dem, was du im Unterricht verwendest, und dem, was deine Schüler nach dem Kurs vorfinden.'),
      lexParagraph('Schneide, was du brauchst. Die Rolle erlaubt dir, Material pro Schüler ohne Verschwendung zu portionieren. Ein Format für Ausbilder, nicht für Einzelpraktiker.', [{ text: 'Schneide, was du brauchst.', bold: true }]),
      lexParagraph('Für Tätowierschulen, Profikurse und Ausbilder, die das Beste für ihre Schüler wollen — ohne Verschwendung und Überraschungen.')
    ),
    featureHighlights: [
      { icon: '📦', title: loc === 'it' ? 'Stessa qualità dei fogli singoli' : loc === 'en' ? 'Same quality as single sheets' : loc === 'fr' ? 'Même qualité que les feuilles' : loc === 'es' ? 'Misma calidad que las láminas' : 'Gleiche Qualität wie Einzelblätter',
        description: loc === 'it' ? 'Identica pelle bifacciale 4mm, stesso processo artigianale Foolish' : loc === 'en' ? 'Identical 4mm double-sided skin, same Foolish handcraft process' : loc === 'fr' ? 'Peau biface 4mm identique, même processus artisanal Foolish' : loc === 'es' ? 'Piel bifacial 4mm idéntica, mismo proceso artesanal Foolish' : 'Identische 4mm doppelseitige Haut, gleicher Foolish-Handwerksprozess' },
      { icon: '✂️', title: loc === 'it' ? 'Taglio su misura' : loc === 'en' ? 'Cut to size' : loc === 'fr' ? 'Coupe sur mesure' : loc === 'es' ? 'Corte a medida' : 'Zuschnitt nach Bedarf',
        description: loc === 'it' ? 'Dosatura del materiale per studente senza sprechi, costo ridotto' : loc === 'en' ? 'Portion material per student without waste, reduced cost' : loc === 'fr' ? 'Distribution du matériel par élève sans gaspillage, coût réduit' : loc === 'es' ? 'Dosificación del material por estudiante sin desperdicio, coste reducido' : 'Material pro Schüler ohne Verschwendung portionieren, reduzierte Kosten' },
      { icon: '🔄', title: loc === 'it' ? 'Doppia faccia per la didattica' : loc === 'en' ? 'Double face for teaching' : loc === 'fr' ? 'Double face pour l\'enseignement' : loc === 'es' ? 'Doble cara para enseñanza' : 'Doppelseite für den Unterricht',
        description: loc === 'it' ? 'Faccia carnato per la pratica, faccia bianca per la valutazione a contrasto' : loc === 'en' ? 'Skin side for practice, white side for contrast evaluation' : loc === 'fr' ? 'Face chair pour la pratique, face blanche pour l\'évaluation' : loc === 'es' ? 'Cara carne para práctica, cara blanca para evaluación a contraste' : 'Hautseite für Übung, weiße Seite für Kontrastbewertung' },
      { icon: '🏫', title: loc === 'it' ? 'Formato scuola' : loc === 'en' ? 'School format' : loc === 'fr' ? 'Format école' : loc === 'es' ? 'Formato escuela' : 'Schulformat',
        description: loc === 'it' ? 'Pensato per formatori, non per singoli praticanti' : loc === 'en' ? 'Designed for educators, not solo practitioners' : loc === 'fr' ? 'Pensé pour les formateurs, pas pour les solitaires' : loc === 'es' ? 'Diseñado para formadores, no para practicantes individuales' : 'Entwickelt für Ausbilder, nicht für Einzelpraktiker' }
    ],
    usageSteps: [
      { step: 1, title: loc === 'it' ? 'Taglia' : loc === 'en' ? 'Cut' : loc === 'fr' ? 'Coupe' : loc === 'es' ? 'Corta' : 'Schneiden',
        description: loc === 'it' ? 'Taglia dal rotolo la quantità necessaria per ogni studente' : loc === 'en' ? 'Cut the required amount for each student from the roll' : loc === 'fr' ? "Coupe la quantité nécessaire pour chaque élève depuis le rouleau" : loc === 'es' ? 'Corta del rollo la cantidad necesaria para cada estudiante' : 'Benötigte Menge pro Schüler von der Rolle schneiden' },
      { step: 2, title: loc === 'it' ? 'Distribuisci' : loc === 'en' ? 'Distribute' : loc === 'fr' ? 'Distribue' : loc === 'es' ? 'Distribuye' : 'Verteilen',
        description: loc === 'it' ? 'Consegna a ogni studente il proprio pezzo per l\'esercizio' : loc === 'en' ? 'Give each student their piece for the exercise' : loc === 'fr' ? "Donne à chaque élève son morceau pour l'exercice" : loc === 'es' ? 'Entrega a cada estudiante su pieza para el ejercicio' : 'Jeder Schüler erhält sein Stück für die Übung' },
      { step: 3, title: loc === 'it' ? 'Valuta' : loc === 'en' ? 'Evaluate' : loc === 'fr' ? 'Évalue' : loc === 'es' ? 'Evalúa' : 'Bewerten',
        description: loc === 'it' ? 'Usa la faccia bianca per valutare il lavoro di ogni studente a contrasto' : loc === 'en' ? 'Use the white face to evaluate each student\'s work in contrast' : loc === 'fr' ? "Utilise la face blanche pour évaluer le travail de chaque élève à contraste" : loc === 'es' ? 'Usa la cara blanca para evaluar el trabajo de cada estudiante a contraste' : 'Weiße Seite zur Kontrastbewertung der Schülerarbeit nutzen' }
    ],
    whatsInTheBox: loc === 'it' ? ['Rotolo T-Sheet DBL 4mm', 'Scheda prodotto con specifiche'] :
                   loc === 'en' ? ['T-Sheet DBL 4mm roll', 'Product card with specifications'] :
                   loc === 'fr' ? ['Rouleau T-Sheet DBL 4mm', 'Fiche produit avec spécifications'] :
                   loc === 'es' ? ['Rollo T-Sheet DBL 4mm', 'Tarjeta de producto con especificaciones'] :
                   ['T-Sheet DBL 4mm Rolle', 'Produktkarte mit Spezifikationen']
  }
}

// ──────────────────────────────────────────
// SCRIPT MAIN
// ──────────────────────────────────────────

async function main() {
  console.log('🚀 Avvio import prodotti Foolish…\n')

  // 1. Wakeup call
  console.log('⏳ Sveglio il CMS…')
  try {
    await fetch(WARMUP)
    console.log('   ✅ CMS sveglio')
  } catch {
    console.log('   ⚠️  Wakeup fallito, procedo lo stesso')
  }
  await new Promise(r => setTimeout(r, 3000))

  // 2. Login
  console.log('🔑 Login…')
  const loginRes = await fetch(`${API_BASE}/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD })
  })
  if (!loginRes.ok) {
    const text = await loginRes.text()
    throw new Error(`Login fallito: ${loginRes.status} ${text.slice(0, 200)}`)
  }
  const loginData = await loginRes.json()
  TOKEN = loginData.token
  if (!TOKEN) throw new Error('Nessun token ricevuto dal login')
  console.log(`   ✅ Login OK (token: ${TOKEN.slice(0, 20)}…)`)

  // Mappa slug script → slug CMS (alcuni slug nel CMS sono diversi)
  const SLUG_MAP = {
    't-sheet-dbl': 't-sheet-dbl',
    'duoskin': 'duoskin',
    'alexs-hand': 't-3d-alexs-hand',
    'p-3d-skin-face-starter-kit': 'p-3d-skin-face-starter-kit',
    't-sheet-dbl-roll': 't-sheet-dbl-in-rotolo'
  }

  // 3. Per ogni slug, trovo ID e attributi del prodotto, più gli ID degli array esistenti
  const productKeys = Object.keys(DATA)
  const productInfo = {} // { [slug]: { id, attributes, name, highlightIds, stepIds, boxIds } }

  for (const key of productKeys) {
    const slug = SLUG_MAP[key]
    console.log(`\n🔍 Cerco prodotto slug="${slug}"…`)
    const res = await api('GET', '/products', null, null, { 'where[slug][equals]': slug, limit: '1' })
    if (!res.docs || res.docs.length === 0) {
      console.log(`   ❌ Prodotto "${slug}" non trovato!`)
      continue
    }
    const p = res.docs[0]
    // Prendo gli IDs delle righe esistenti negli array (servono per PATCH localized)
    const highlightIds = (p.featureHighlights || []).map(h => h.id).filter(Boolean)
    const stepIds = (p.usageSteps || []).map(s => s.id).filter(Boolean)
    const boxIds = (p.whatsInTheBox || []).map(w => w.id).filter(Boolean)
    productInfo[slug] = {
      id: p.id,
      attributes: p.attributes || [],
      name: p.name,
      highlightIds,
      stepIds,
      boxIds
    }
    console.log(`   ✅ ID: ${p.id} — ${p.name} (${p.attributes?.length || 0} attributi, ${highlightIds.length} highlights, ${stepIds.length} steps, ${boxIds.length} box)`)
  }

  // 4. PATCH per ogni prodotto × ogni lingua
  let totalPatches = 0
  let errors = 0

  for (const key of productKeys) {
    const slug = SLUG_MAP[key]
    const info = productInfo[slug]
    if (!info) continue
    const { id, attributes, name, highlightIds, stepIds, boxIds } = info

    const productData = DATA[key]
    for (const locale of LOCALES) {
      let localeData = productData[locale]
      if (!localeData) continue

      // Normalizza: icon → valori validi (sparkles/shield/star/truck)
      localeData = JSON.parse(JSON.stringify(localeData))
      const iconMap = { '1️⃣': 'sparkles', '2️⃣': 'shield', '3️⃣': 'star', '4️⃣': 'truck', '📏': 'shield', '🔄': 'sparkles', '🎯': 'star', '🎨': 'star', '✋': 'sparkles', '🔧': 'sparkles', '🏆': 'star', '🧪': 'shield', '🧑': 'sparkles', '🔩': 'shield', '🖼️': 'truck', '📦': 'truck', '✂️': 'truck', '🏫': 'sparkles' }
      if (localeData.featureHighlights) {
        localeData.featureHighlights = localeData.featureHighlights.map((h, i) => ({
          ...h,
          icon: iconMap[h.icon] || 'sparkles',
          id: highlightIds[i] || undefined
        }))
      }
      if (localeData.usageSteps) {
        localeData.usageSteps = localeData.usageSteps.map((s, i) => ({
          ...s,
          step: String(s.step),
          id: stepIds[i] || undefined
        }))
      }
      if (localeData.whatsInTheBox) {
        localeData.whatsInTheBox = localeData.whatsInTheBox.map((w, i) => ({
          ...(typeof w === 'string' ? { label: w, description: w } : { label: w.label, description: w.description || w.label }),
          id: boxIds[i] || undefined
        }))
      }

      // Include name e attributes (richiesti per tutti i locale da Payload)
      localeData.name = name
      localeData.attributes = attributes

      console.log(`   📝 ${key} → ${locale}…`)
      try {
        const result = await api('PATCH', `/products/${id}`, localeData, locale)
        totalPatches++
        console.log(`      ✅ ${result.doc?.name || result.message || 'OK'} (${locale})`)
      } catch (err) {
        errors++
        console.log(`      ❌ ${err.message}`)
      }

      // Piccolo delay per non stressare Railway
      await new Promise(r => setTimeout(r, 500))
    }
  }

  console.log(`\n📊 Riepilogo: ${totalPatches} PATCH riuscite, ${errors} errori`)
}

main().catch(err => {
  console.error('\n❌ ERRORE FATALE:', err.message)
  process.exit(1)
})
