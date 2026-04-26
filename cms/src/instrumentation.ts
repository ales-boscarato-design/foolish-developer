export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { getPayload } = await import('payload')
      const { default: config } = await import('@payload-config')
      await getPayload({ config })
      console.log('[Payload] Database initialized (push complete)')
    } catch (err) {
      console.error('[Payload] Database init failed:', err)
      throw err
    }
  }
}
