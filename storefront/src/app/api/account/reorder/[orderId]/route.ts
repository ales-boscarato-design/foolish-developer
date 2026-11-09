import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/account-auth'
import { handleReorder } from '@/lib/reorder'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { orderId } = await params
  return handleReorder({ orderId, sessionEmail: session.email })
}
