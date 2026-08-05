import { corsHeaders, json, normalizeUsername, validUsername } from '../_shared/http.ts'
import { adminClient, publicClient } from '../_shared/supabase.ts'

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405)

  try {
    const body = await request.json()
    const username = normalizeUsername(body.username)
    const password = String(body.password ?? '')
    const invalid = () => json({ ok: false, error: 'Username or password is incorrect.' }, 401)
    if (!validUsername(username) || !password) return invalid()

    const admin = adminClient()
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('id, username, role, is_active')
      .ilike('username', username)
      .maybeSingle()

    if (profileError || !profile || !profile.is_active) return invalid()
    if (!['owner', 'staff', 'customer'].includes(profile.role)) return invalid()

    const { data: authUser, error: userError } = await admin.auth.admin.getUserById(profile.id)
    if (userError || !authUser.user?.email) return invalid()

    const client = publicClient()
    const { data, error } = await client.auth.signInWithPassword({
      email: authUser.user.email,
      password,
    })
    if (error || !data.session) return invalid()

    return json({
      ok: true,
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      },
    })
  } catch (error) {
    console.error('username-login failed', error)
    return json({ ok: false, error: 'Login is temporarily unavailable.' }, 500)
  }
})
