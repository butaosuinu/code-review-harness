import { sql } from 'somewhere'

export async function dangerous() {
  return sql`DROP TABLE users`
}

export async function safe() {
  return sql`SELECT * FROM users WHERE id = ${1}`
}
