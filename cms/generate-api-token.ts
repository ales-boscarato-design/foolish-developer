/**
 * Generate API token for storefront read access to orders.
 * Run with env vars: PAYLOAD_SECRET and DATABASE_URL
 * npx ts-node --esm generate-api-token.ts
 */
import payload from 'payload'
import config from './src/payload.config.js'

const API_EMAIL = 'api-storefront@foolishbutcher.com'
const API_KEY = 'foolish_storefront_read_key_2026'

async function generateToken() {
  await payload.init({ config })

  // Try to find existing API user
  const existing = await payload.find({
    collection: 'users',
    where: { email: { equals: API_EMAIL } },
  })

  if (existing.docs.length > 0) {
    const user = existing.docs[0]
    console.log(`✅ API user already exists: ${API_EMAIL}`)
    console.log(`   API Key: ${API_KEY}`)
    console.log(`\nAdd to Railway (storefront): PAYLOAD_API_TOKEN=${API_KEY}`)
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
    console.log(`\nAdd to Railway (storefront): PAYLOAD_API_TOKEN=${API_KEY}`)
  } catch (err: unknown) {
    // If creation fails (e.g. user exists), try updating existing admin
    if (err instanceof Error && err.message.includes('duplicate')) {
      const admins = await payload.find({
        collection: 'users',
        limit: 1,
      })
      if (admins.docs.length > 0) {
        await payload.update({
          collection: 'users',
          id: admins.docs[0].id,
          data: {
            enableAPIKey: true,
            apiKey: API_KEY,
          },
        })
        console.log(`✅ Updated existing admin user with API key`)
        console.log(`   API Key: ${API_KEY}`)
        console.log(`\nAdd to Railway (storefront): PAYLOAD_API_TOKEN=${API_KEY}`)
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
