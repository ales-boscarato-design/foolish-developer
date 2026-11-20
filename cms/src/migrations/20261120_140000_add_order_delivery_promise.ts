import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * Snapshot della promessa di consegna sull'ordine (`deliveryPromise`).
 *
 * PERCHE'. La data mostrata nel carrello nasce da un calcolo che dipende da
 * festivita' italiane, `productionDays` del CMS, paese di destinazione, margine
 * prudente e ora del cutoff. Se dopo il pagamento la si ricalcolasse, il
 * cliente vedrebbe una data diversa da quella che ha accettato: qui la promessa
 * diventa un dato dell'ordine, con la partenza da cui e' contata e i valori di
 * produzione che l'hanno prodotta.
 *
 * ADDITIVA E NULLA-SAFE. Tutte le colonne sono nullable e senza default: gli
 * ordini storici non hanno mai promesso una data e restano validi con NULL (non
 * si inventa una data retroattiva). L'obbligo dello snapshot per i nuovi ordini
 * del checkout e' nella collection (`normalizeDeliveryPromise`), dove si sa se
 * l'ordine arriva dalla macchina; un vincolo NOT NULL qui romperebbe la
 * migration sui documenti esistenti.
 *
 * I VINCOLI NON RICALCOLANO LA DATA. Verificano solo la coerenza interna dello
 * snapshot (le date ci sono quando la promessa e' mostrata, la consegna non
 * precede la partenza, il margine e' uno di quelli previsti). La regola
 * commerciale vive nel codice: il database non deve poter dire che una
 * promessa gia' fatta e' sbagliata perche' oggi il calcolo darebbe altro.
 *
 * ROLLBACK. Non distruttivo, per scelta: `down()` toglie indici e vincoli ma
 * NON le colonne. Per un ordine nuovo lo snapshot e' l'unica copia della data
 * promessa (non e' ricalcolabile: il calcolo di oggi darebbe un altro numero),
 * quindi un `DROP COLUMN` cancellerebbe un impegno preso con il cliente. Con
 * `push: false` il verso del rollback e' il revert del codice: Payload legge
 * solo i campi dichiarati nella collection, quindi le colonne restano innocue.
 * La migrazione e' idempotente (`IF NOT EXISTS`), quindi dopo un rollback un
 * nuovo `up()` non fallisce.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "enum_orders_delivery_promise_reason" AS ENUM ('ok', 'estimate_unavailable', 'not_shown', 'not_captured');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)

  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "enum_orders_delivery_promise_zone" AS ENUM ('IT_EU', 'EXTRA_EU');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)

  await db.execute(sql`
    ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "delivery_promise_version" numeric,
      ADD COLUMN IF NOT EXISTS "delivery_promise_promise_shown" boolean,
      ADD COLUMN IF NOT EXISTS "delivery_promise_zone" "enum_orders_delivery_promise_zone",
      ADD COLUMN IF NOT EXISTS "delivery_promise_departure_date" varchar,
      ADD COLUMN IF NOT EXISTS "delivery_promise_estimated_delivery_date" varchar,
      ADD COLUMN IF NOT EXISTS "delivery_promise_production_days" numeric,
      ADD COLUMN IF NOT EXISTS "delivery_promise_margin_days" numeric,
      ADD COLUMN IF NOT EXISTS "delivery_promise_fallback" boolean,
      ADD COLUMN IF NOT EXISTS "delivery_promise_reason" "enum_orders_delivery_promise_reason",
      ADD COLUMN IF NOT EXISTS "delivery_promise_calculated_at" timestamp(3) with time zone
  `)

  await db.execute(sql`
    DO $$ BEGIN
      ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_promise_version_check"
        CHECK ("delivery_promise_version" IS NULL OR "delivery_promise_version" = 1);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)
  await db.execute(sql`
    DO $$ BEGIN
      ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_promise_reason_consistency_check"
        CHECK (
          "delivery_promise_promise_shown" IS DISTINCT FROM true
          OR ("delivery_promise_reason" = 'ok'
              AND "delivery_promise_zone" IS NOT NULL
              AND "delivery_promise_departure_date" IS NOT NULL
              AND "delivery_promise_estimated_delivery_date" IS NOT NULL
              AND "delivery_promise_margin_days" IS NOT NULL)
        );
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)
  await db.execute(sql`
    DO $$ BEGIN
      ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_promise_no_dates_when_hidden_check"
        CHECK (
          "delivery_promise_promise_shown" IS TRUE
          OR ("delivery_promise_departure_date" IS NULL
              AND "delivery_promise_estimated_delivery_date" IS NULL
              AND "delivery_promise_margin_days" IS NULL
              AND "delivery_promise_fallback" IS NOT TRUE)
        );
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)
  await db.execute(sql`
    DO $$ BEGIN
      ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_promise_order_check"
        CHECK (
          "delivery_promise_departure_date" IS NULL
          OR "delivery_promise_estimated_delivery_date" IS NULL
          OR "delivery_promise_departure_date" <= "delivery_promise_estimated_delivery_date"
        );
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)
  await db.execute(sql`
    DO $$ BEGIN
      ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_promise_margin_days_check"
        CHECK ("delivery_promise_margin_days" IS NULL OR "delivery_promise_margin_days" IN (2, 3, 6, 7));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)
  await db.execute(sql`
    DO $$ BEGIN
      ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_promise_production_days_check"
        CHECK (
          "delivery_promise_production_days" IS NULL
          OR ("delivery_promise_production_days" = trunc("delivery_promise_production_days")
              AND "delivery_promise_production_days" BETWEEN 0 AND 3650)
        );
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)
  // Forma `YYYY-MM-DD` con mese e giorno validi (non il calendario lavorativo:
  // quello e' una regola commerciale e vive nel codice).
  await db.execute(sql`
    DO $$ BEGIN
      ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_promise_departure_date_shape_check"
        CHECK (
          "delivery_promise_departure_date" IS NULL
          OR "delivery_promise_departure_date" ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
        );
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)
  await db.execute(sql`
    DO $$ BEGIN
      ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_promise_eta_date_shape_check"
        CHECK (
          "delivery_promise_estimated_delivery_date" IS NULL
          OR "delivery_promise_estimated_delivery_date" ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
        );
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "orders_delivery_promise_eta_idx"
      ON "orders" USING btree ("delivery_promise_estimated_delivery_date")
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`DROP INDEX IF EXISTS "orders_delivery_promise_eta_idx"`)
  await db.execute(sql`
    ALTER TABLE "orders"
      DROP CONSTRAINT IF EXISTS "orders_delivery_promise_eta_date_shape_check",
      DROP CONSTRAINT IF EXISTS "orders_delivery_promise_departure_date_shape_check",
      DROP CONSTRAINT IF EXISTS "orders_delivery_promise_production_days_check",
      DROP CONSTRAINT IF EXISTS "orders_delivery_promise_margin_days_check",
      DROP CONSTRAINT IF EXISTS "orders_delivery_promise_order_check",
      DROP CONSTRAINT IF EXISTS "orders_delivery_promise_no_dates_when_hidden_check",
      DROP CONSTRAINT IF EXISTS "orders_delivery_promise_reason_consistency_check",
      DROP CONSTRAINT IF EXISTS "orders_delivery_promise_version_check"
  `)
  // Intenzionalmente nessun DROP COLUMN e nessun DROP TYPE: vedi l'intestazione.
  // Le colonne contengono l'unica copia della promessa fatta a un cliente.
}
