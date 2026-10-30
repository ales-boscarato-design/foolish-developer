import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/account-auth'
import { claimBrowserEndpoint } from '@/lib/account-db'
import { handlePushClaim } from '@/lib/push-claim'

export async function POST(req: NextRequest) {
  let body: unknown = null
  try {
    body = await req.json()
  } catch {
    // body non JSON: handlePushClaim risponde 400
  }
  const result = await handlePushClaim(
    { session: getSession, claim: claimBrowserEndpoint },
    body
  )
  return NextResponse.json(result.body, { status: result.status })
}
