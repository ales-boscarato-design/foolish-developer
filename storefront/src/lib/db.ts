import postgres from 'postgres'

declare global {

  var _sqlConn: ReturnType<typeof postgres> | undefined
}

// Singleton: reuse connection across hot-reloads in dev
const sql = globalThis._sqlConn ?? postgres(process.env.DATABASE_URL!, {
  max: 5,
  idle_timeout: 20,
  connect_timeout: 10,
})

if (process.env.NODE_ENV !== 'production') {
  globalThis._sqlConn = sql
}

export default sql
