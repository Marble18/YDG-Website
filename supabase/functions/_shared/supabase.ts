import { createClient } from 'npm:@supabase/supabase-js@2'

function firstConfiguredKey(jsonName: string, legacyName: string) {
  const configured = Deno.env.get(jsonName)
  if (configured) {
    const values = Object.values(JSON.parse(configured)) as string[]
    if (values[0]) return values[0]
  }
  const legacy = Deno.env.get(legacyName)
  if (!legacy) throw new Error(`Missing ${jsonName}`)
  return legacy
}

export function adminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    firstConfiguredKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

export function publicClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    firstConfiguredKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY'),
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}
