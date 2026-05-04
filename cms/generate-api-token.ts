/**
 * Generate API token for storefront read access to orders.
 * Run: npx ts-node --esm generate-api-token.ts
 * Requires: PAYLOAD_SECRET and DATABASE_URL in .env or environment
 */
import 'dotenv/config'
import payload from 'payload'

const API_EMAIL = 'api-storefront@foolishbutcher.com'
const API_KEY = 'foolish_storefront_read_key_2026'

async function generateToken() {
  await payload.init({
    secret: process.env.PAYLOAD_SECRET!,
    local: true,
  })

  // Check if API user already exists
  const existing = await payload.find({
    collection: 'users',
    where: { email: { equals: API_EMAIL } },
  })

  if (existing.docs.length > 0) {
    const user = existing.docs[0] as { id: number; email: string }
    // @ts-ignore
    if (user.enableAPIKey) {
      console.log(`✅ API user already exists: ${API_EMAIL}`)
      console.log(`   API Key: ${API_KEY}`)
      console.log(`\nAdd to Railway storefront env: PAYLOAD_API_TOKEN=${API_KEY}`)
    } else {
      await payload.update({
        collection: 'users',
        id: user.id,
        data: { enableAPIKey: true, apiKey: API_KEY },
      })
      console.log(`✅ Updated existing user with API key`)
      console.log(`   API Key: ${API_KEY}`)
      console.log(`\nAdd to Railway storefront env: PAYLOAD_API_TOKEN=${API_KEY}`)
    }
    process.exit(0)
  }

  // Create new API user
  try {
    await payload.create({
      collection: 'users',
      data: {
        email: API_EMAIL,
        password: 'DO_NOT_USE_THIS_PASSWORD_2026',
        enableAPIKey: true,
        apiKey: API_KEY,
      },
    })
    console.log(`✅ API user created: ${API_EMAIL}`)
    console.log(`   API Key: ${API_KEY}`)
    console.log(`\nAdd to Railway storefront env: PAYLOAD_API_TOKEN=${API_KEY}`)
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('duplicate')) {
      // User exists but with different email — find by first user (admin)
      const admins = await payload.find({ collection: 'users', limit: 1 })
      if (admins.docs.length > 0) {
        const admin = admins.docs[0] as { id: number }
        await payload.update({
          collection: 'users',
          id: admin.id,
          data: { enableAPIKey: true, apiKey: API_KEY },
        })
        console.log(`✅ Added API key to existing admin user`)
        console.log(`   API Key: ${API_KEY}`)
        console.log(`\nAdd to Railway storefront env: PAYLOAD_API_TOKEN=${API_KEY}`)
      }
    } else {
      throw err
    }
  }

  process.exit(0)
}

generateToken().catch((err) => {
  console.error('❌ Error:', err)
  process.exit(1)
})
