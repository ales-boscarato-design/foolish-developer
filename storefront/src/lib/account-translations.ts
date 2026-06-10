// Client-safe: no server imports. Used by both server and client components.

export const translations = {
  it: {
    nav_home: 'Home', nav_orders: 'Ordini', nav_collection: 'Collezione', nav_files: 'File', nav_profile: 'Profilo',
    hello: 'Ciao', customer: 'Cliente', orders_total: 'ordini',
    active_order: 'Ordine in corso', last_received: 'Ultimo ricevuto', saved: 'Salvati', view_all: 'Vedi tutti →', eta_days: 'giorni',
    your_orders: 'I tuoi ordini', orders_count: 'ordini totali', detail: 'Dettaglio →',
    order_label: 'Ordine', your_sheets: 'I tuoi fogli', tracking: 'Tracking',
    received: 'Ricevuto', eta_pending: 'In attesa ETA', eta_confirmed: 'Confermato',
    in_production: 'In produzione', matching_pending: 'Abbinamento', matched: 'Abbinato',
    preview_sent: 'Preview inviata', shipped: 'Spedito', delivered: 'Consegnato',
    followup_done: 'Completato', closed: 'Chiuso',
    your_collection: 'La tua collezione', sheets_received: 'fogli ricevuti', incoming: 'In arrivo',
    sheets_appear: 'I tuoi fogli appariranno qui dopo la spedizione.', other_format: 'Altro',
    files_title: 'File & Wishlist', your_resources: 'Le tue risorse', files: 'File', wishlist: 'Salvati',
    no_files: 'Nessun file disponibile al momento.',
    no_wishlist: 'Nessun prodotto salvato. Usa il bottone "Salva" sui prodotti.', buy: 'Acquista', remove: 'Rimuovi',
    who_are_you: 'Chi sei', preferred_style: 'Stile preferito', comm_language: 'Lingua comunicazioni',
    notifications: 'Notifiche', notify_orders_label: 'Aggiornamenti ordine', notify_orders_sub: 'Produzione, spedizione, consegna',
    notify_batches_label: 'Nuovi lotti', notify_batches_sub: 'Quando arriva flock che ti piace',
    notify_offers_label: 'Offerte personalizzate', notify_offers_sub: 'Max 1 a settimana',
    push_active: '✓ Push notifiche attive', push_denied: 'Push bloccate dal browser. Abilita dalle impostazioni.',
    push_enable: 'Attiva notifiche push →', logout: "Esci dall'account", saved_label: 'Salvato ✓', reorder: 'Riordina',
    level_tatuatore: 'Tatuatore', level_pmu: 'PMU', level_studente: 'Studente', level_professionista: 'Professionista',
    login_title: 'La tua area', login_subtitle: 'Inserisci la tua email per ricevere il link di accesso.',
    login_placeholder: 'email@esempio.it', login_button: 'Invia link →', login_sending: 'Invio...',
    login_sent_title: 'Controlla la tua email',
    login_sent_msg: 'Ti abbiamo inviato un link di accesso a $email. Scade in 15 minuti.',
    login_error_expired: 'Il link è scaduto. Richiedi un nuovo link.',
    login_error_missing: 'Link non valido. Richiedi un nuovo link.',
  },
  en: {
    nav_home: 'Home', nav_orders: 'Orders', nav_collection: 'Collection', nav_files: 'Files', nav_profile: 'Profile',
    hello: 'Hello', customer: 'Customer', orders_total: 'orders',
    active_order: 'Order in progress', last_received: 'Last received', saved: 'Saved', view_all: 'View all →', eta_days: 'days',
    your_orders: 'Your orders', orders_count: 'total orders', detail: 'Detail →',
    order_label: 'Order', your_sheets: 'Your sheets', tracking: 'Tracking',
    received: 'Received', eta_pending: 'Awaiting ETA', eta_confirmed: 'Confirmed',
    in_production: 'In production', matching_pending: 'Matching', matched: 'Matched',
    preview_sent: 'Preview sent', shipped: 'Shipped', delivered: 'Delivered',
    followup_done: 'Completed', closed: 'Closed',
    your_collection: 'Your collection', sheets_received: 'sheets received', incoming: 'Incoming',
    sheets_appear: 'Your sheets will appear here after shipment.', other_format: 'Other',
    files_title: 'Files & Wishlist', your_resources: 'Your resources', files: 'Files', wishlist: 'Saved',
    no_files: 'No files available at the moment.',
    no_wishlist: 'No saved products. Use the "Save" button on products.', buy: 'Buy', remove: 'Remove',
    who_are_you: 'Who are you', preferred_style: 'Preferred style', comm_language: 'Communication language',
    notifications: 'Notifications', notify_orders_label: 'Order updates', notify_orders_sub: 'Production, shipping, delivery',
    notify_batches_label: 'New batches', notify_batches_sub: 'When flock you like arrives',
    notify_offers_label: 'Personalised offers', notify_offers_sub: 'Max 1 per week',
    push_active: '✓ Push notifications active', push_denied: 'Push blocked by browser. Enable in settings.',
    push_enable: 'Enable push notifications →', logout: 'Sign out', saved_label: 'Saved ✓', reorder: 'Reorder',
    level_tatuatore: 'Tattoo artist', level_pmu: 'PMU', level_studente: 'Student', level_professionista: 'Professional',
    login_title: 'Your area', login_subtitle: 'Enter your email to receive the access link.',
    login_placeholder: 'email@example.com', login_button: 'Send link →', login_sending: 'Sending...',
    login_sent_title: 'Check your email',
    login_sent_msg: 'We sent an access link to $email. It expires in 15 minutes.',
    login_error_expired: 'The link has expired. Please request a new one.',
    login_error_missing: 'Invalid link. Please request a new one.',
  },
  fr: {
    nav_home: 'Accueil', nav_orders: 'Commandes', nav_collection: 'Collection', nav_files: 'Fichiers', nav_profile: 'Profil',
    hello: 'Bonjour', customer: 'Client', orders_total: 'commandes',
    active_order: 'Commande en cours', last_received: 'Dernière reçue', saved: 'Sauvegardés', view_all: 'Voir tout →', eta_days: 'jours',
    your_orders: 'Vos commandes', orders_count: 'commandes au total', detail: 'Détail →',
    order_label: 'Commande', your_sheets: 'Vos feuilles', tracking: 'Suivi',
    received: 'Reçu', eta_pending: 'En attente ETA', eta_confirmed: 'Confirmé',
    in_production: 'En production', matching_pending: 'Appariement', matched: 'Apparié',
    preview_sent: 'Aperçu envoyé', shipped: 'Expédié', delivered: 'Livré',
    followup_done: 'Terminé', closed: 'Fermé',
    your_collection: 'Votre collection', sheets_received: 'feuilles reçues', incoming: 'En route',
    sheets_appear: "Vos feuilles apparaîtront ici après l'expédition.", other_format: 'Autre',
    files_title: 'Fichiers & Favoris', your_resources: 'Vos ressources', files: 'Fichiers', wishlist: 'Sauvegardés',
    no_files: 'Aucun fichier disponible pour le moment.',
    no_wishlist: 'Aucun produit sauvegardé. Utilisez le bouton "Sauvegarder".', buy: 'Acheter', remove: 'Supprimer',
    who_are_you: 'Qui êtes-vous', preferred_style: 'Style préféré', comm_language: 'Langue de communication',
    notifications: 'Notifications', notify_orders_label: 'Mises à jour commande', notify_orders_sub: 'Production, expédition, livraison',
    notify_batches_label: 'Nouveaux lots', notify_batches_sub: "Quand du flock qui vous plaît arrive",
    notify_offers_label: 'Offres personnalisées', notify_offers_sub: 'Max 1 par semaine',
    push_active: '✓ Notifications push actives', push_denied: 'Push bloqué par le navigateur. Activez dans les paramètres.',
    push_enable: 'Activer les notifications push →', logout: 'Se déconnecter', saved_label: 'Enregistré ✓', reorder: 'Recommander',
    level_tatuatore: 'Tatoueur', level_pmu: 'PMU', level_studente: 'Étudiant', level_professionista: 'Professionnel',
    login_title: 'Votre espace', login_subtitle: 'Entrez votre email pour recevoir le lien de connexion.',
    login_placeholder: 'email@exemple.fr', login_button: 'Envoyer le lien →', login_sending: 'Envoi...',
    login_sent_title: 'Vérifiez votre email',
    login_sent_msg: 'Nous avons envoyé un lien de connexion à $email. Il expire dans 15 minutes.',
    login_error_expired: 'Le lien a expiré. Veuillez en demander un nouveau.',
    login_error_missing: 'Lien invalide. Veuillez en demander un nouveau.',
  },
  es: {
    nav_home: 'Inicio', nav_orders: 'Pedidos', nav_collection: 'Colección', nav_files: 'Archivos', nav_profile: 'Perfil',
    hello: 'Hola', customer: 'Cliente', orders_total: 'pedidos',
    active_order: 'Pedido en curso', last_received: 'Último recibido', saved: 'Guardados', view_all: 'Ver todos →', eta_days: 'días',
    your_orders: 'Tus pedidos', orders_count: 'pedidos en total', detail: 'Detalle →',
    order_label: 'Pedido', your_sheets: 'Tus hojas', tracking: 'Seguimiento',
    received: 'Recibido', eta_pending: 'Esperando ETA', eta_confirmed: 'Confirmado',
    in_production: 'En producción', matching_pending: 'Emparejamiento', matched: 'Emparejado',
    preview_sent: 'Vista previa enviada', shipped: 'Enviado', delivered: 'Entregado',
    followup_done: 'Completado', closed: 'Cerrado',
    your_collection: 'Tu colección', sheets_received: 'hojas recibidas', incoming: 'En camino',
    sheets_appear: 'Tus hojas aparecerán aquí después del envío.', other_format: 'Otro',
    files_title: 'Archivos & Favoritos', your_resources: 'Tus recursos', files: 'Archivos', wishlist: 'Guardados',
    no_files: 'No hay archivos disponibles por el momento.',
    no_wishlist: 'Ningún producto guardado. Usa el botón "Guardar".', buy: 'Comprar', remove: 'Eliminar',
    who_are_you: 'Quién eres', preferred_style: 'Estilo preferido', comm_language: 'Idioma de comunicación',
    notifications: 'Notificaciones', notify_orders_label: 'Actualizaciones de pedido', notify_orders_sub: 'Producción, envío, entrega',
    notify_batches_label: 'Nuevos lotes', notify_batches_sub: 'Cuando llegue flock que te guste',
    notify_offers_label: 'Ofertas personalizadas', notify_offers_sub: 'Máx. 1 por semana',
    push_active: '✓ Notificaciones push activas', push_denied: 'Push bloqueado por el navegador. Actívalo en configuración.',
    push_enable: 'Activar notificaciones push →', logout: 'Cerrar sesión', saved_label: 'Guardado ✓', reorder: 'Volver a pedir',
    level_tatuatore: 'Tatuador', level_pmu: 'PMU', level_studente: 'Estudiante', level_professionista: 'Profesional',
    login_title: 'Tu área', login_subtitle: 'Introduce tu email para recibir el enlace de acceso.',
    login_placeholder: 'email@ejemplo.es', login_button: 'Enviar enlace →', login_sending: 'Enviando...',
    login_sent_title: 'Revisa tu email',
    login_sent_msg: 'Enviamos un enlace de acceso a $email. Caduca en 15 minutos.',
    login_error_expired: 'El enlace ha caducado. Solicita uno nuevo.',
    login_error_missing: 'Enlace inválido. Solicita uno nuevo.',
  },
  de: {
    nav_home: 'Start', nav_orders: 'Bestellungen', nav_collection: 'Sammlung', nav_files: 'Dateien', nav_profile: 'Profil',
    hello: 'Hallo', customer: 'Kunde', orders_total: 'Bestellungen',
    active_order: 'Laufende Bestellung', last_received: 'Zuletzt erhalten', saved: 'Gespeichert', view_all: 'Alle anzeigen →', eta_days: 'Tage',
    your_orders: 'Deine Bestellungen', orders_count: 'Bestellungen insgesamt', detail: 'Detail →',
    order_label: 'Bestellung', your_sheets: 'Deine Bögen', tracking: 'Sendungsverfolgung',
    received: 'Erhalten', eta_pending: 'ETA ausstehend', eta_confirmed: 'Bestätigt',
    in_production: 'In Produktion', matching_pending: 'Zuordnung', matched: 'Zugeordnet',
    preview_sent: 'Vorschau gesendet', shipped: 'Versandt', delivered: 'Geliefert',
    followup_done: 'Abgeschlossen', closed: 'Geschlossen',
    your_collection: 'Deine Sammlung', sheets_received: 'Bögen erhalten', incoming: 'Unterwegs',
    sheets_appear: 'Deine Bögen erscheinen hier nach dem Versand.', other_format: 'Sonstige',
    files_title: 'Dateien & Wunschliste', your_resources: 'Deine Ressourcen', files: 'Dateien', wishlist: 'Gespeichert',
    no_files: 'Derzeit keine Dateien verfügbar.',
    no_wishlist: 'Keine gespeicherten Produkte. Nutze den "Speichern"-Button.', buy: 'Kaufen', remove: 'Entfernen',
    who_are_you: 'Wer bist du', preferred_style: 'Bevorzugter Stil', comm_language: 'Kommunikationssprache',
    notifications: 'Benachrichtigungen', notify_orders_label: 'Bestellaktualisierungen', notify_orders_sub: 'Produktion, Versand, Lieferung',
    notify_batches_label: 'Neue Chargen', notify_batches_sub: 'Wenn Flock ankommt, das dir gefällt',
    notify_offers_label: 'Personalisierte Angebote', notify_offers_sub: 'Max. 1 pro Woche',
    push_active: '✓ Push-Benachrichtigungen aktiv', push_denied: 'Push vom Browser blockiert. In Einstellungen aktivieren.',
    push_enable: 'Push-Benachrichtigungen aktivieren →', logout: 'Abmelden', saved_label: 'Gespeichert ✓', reorder: 'Neu bestellen',
    level_tatuatore: 'Tätowierer', level_pmu: 'PMU', level_studente: 'Student', level_professionista: 'Profi',
    login_title: 'Dein Bereich', login_subtitle: 'Gib deine E-Mail ein, um den Zugangslink zu erhalten.',
    login_placeholder: 'email@beispiel.de', login_button: 'Link senden →', login_sending: 'Wird gesendet...',
    login_sent_title: 'Prüfe deine E-Mail',
    login_sent_msg: 'Wir haben einen Zugangslink an $email gesendet. Er läuft in 15 Minuten ab.',
    login_error_expired: 'Der Link ist abgelaufen. Bitte fordere einen neuen an.',
    login_error_missing: 'Ungültiger Link. Bitte fordere einen neuen an.',
  },
}

export type AccountLocale = keyof typeof translations
export type AccountTKey = keyof typeof translations.it

export const SUPPORTED_LOCALES: AccountLocale[] = ['it', 'en', 'fr', 'es', 'de']

export function getT(locale: AccountLocale) {
  const dict = translations[locale] ?? translations.it
  return (key: AccountTKey): string => (dict as typeof translations.it)[key] ?? translations.it[key]
}

/** Detect locale from browser navigator.language (client-side only) */
export function detectBrowserLocale(): AccountLocale {
  if (typeof navigator === 'undefined') return 'it'
  const lang = navigator.language?.slice(0, 2).toLowerCase()
  return SUPPORTED_LOCALES.includes(lang as AccountLocale) ? (lang as AccountLocale) : 'it'
}

/** Read foolish_locale cookie (client-side only) */
export function getClientLocale(): AccountLocale {
  if (typeof document === 'undefined') return 'it'
  const match = document.cookie.match(/(?:^|;\s*)foolish_locale=([^;]+)/)
  const val = match?.[1]
  if (val && SUPPORTED_LOCALES.includes(val as AccountLocale)) return val as AccountLocale
  return detectBrowserLocale()
}
