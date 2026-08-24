import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL!, { max: 5 })

export default sql

export interface ProMember {
  id: number
  email: string
  business_name: string
  contact_name: string
  vat_number: string
  status: 'active' | 'suspended'
  discount_code: string
  total_spent: number
  order_count: number
  phone: string | null
}

export async function findProMemberByEmail(email: string): Promise<ProMember | null> {
  const rows = await sql<ProMember[]>`
    SELECT id, email, business_name, contact_name, vat_number, status, discount_code, total_spent, order_count, phone
    FROM pro_members
    WHERE email = ${email}
    LIMIT 1
  `
  return rows[0] ?? null
}
