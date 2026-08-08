import { corsHeaders, json, normalizeUsername, validPassword, validUsername } from '../_shared/http.ts'
import { adminClient, publicClient } from '../_shared/supabase.ts'

type Profile = { id: string; username: string; full_name: string | null; role: string; is_active: boolean; created_at: string }

async function requireOperator(request: Request) {
  const header = request.headers.get('Authorization') ?? ''
  const token = header.replace(/^Bearer\s+/i, '')
  if (!token) return null

  const { data, error } = await publicClient().auth.getUser(token)
  if (error || !data.user) return null

  const admin = adminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('id, role, is_active')
    .eq('id', data.user.id)
    .maybeSingle()

  if (!profile?.is_active || !['owner', 'staff'].includes(profile.role)) return null
  return { admin, caller: profile }
}

function accountView(profile: Profile) {
  return {
    id: profile.id,
    username: profile.username,
    fullName: profile.full_name ?? '',
    role: profile.role,
    isActive: profile.is_active,
    createdAt: profile.created_at,
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405)

  try {
    const auth = await requireOperator(request)
    if (!auth) return json({ ok: false, error: 'Active owner or staff access is required.' }, 403)
    const { admin, caller } = auth
    const body = await request.json()

    if (body.action === 'list') {
      let query = admin
        .from('profiles')
        .select('id, username, full_name, role, is_active, created_at')
      query = caller.role === 'owner' ? query.in('role', ['owner', 'staff', 'customer']) : query.eq('role', 'customer')
      const { data, error } = await query
        .order('created_at', { ascending: false })
      if (error) throw error
      return json({ ok: true, accounts: (data as Profile[]).map(accountView) })
    }

    if (body.action === 'create') {
      const account = body.account ?? {}
      const username = normalizeUsername(account.username)
      const password = String(account.password ?? '')
      const fullName = String(account.fullName ?? '').trim()
      const role = account.role === 'customer' ? 'customer' : account.role === 'staff' ? 'staff' : null
      if (!validUsername(username)) return json({ ok: false, error: 'Username must be 3–32 lowercase letters, numbers, dot, dash or underscore.' }, 400)
      if (!fullName || fullName.length > 100) return json({ ok: false, error: 'Full name is required and must be under 100 characters.' }, 400)
      if (!role) return json({ ok: false, error: 'Only customer or staff accounts can be created.' }, 400)
      if (caller.role === 'staff' && role !== 'customer') return json({ ok: false, error: 'Staff can create customer accounts only.' }, 403)
      if (!validPassword(password)) return json({ ok: false, error: 'Password must be at least 6 characters.' }, 400)

      const email = `${username}@accounts.ydg.invalid`
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { username, full_name: fullName },
        app_metadata: { managed_account: true },
      })
      if (createError || !created.user) {
        const duplicate = /already|registered|exists/i.test(createError?.message ?? '')
        return json({ ok: false, error: duplicate ? 'That username is already in use.' : 'Account could not be created.' }, duplicate ? 409 : 400)
      }

      const { data: profile, error: profileError } = await admin
        .from('profiles')
        .upsert({ id: created.user.id, username, full_name: fullName, role, is_active: true }, { onConflict: 'id' })
        .select('id, username, full_name, role, is_active, created_at')
        .single()
      if (profileError) {
        await admin.auth.admin.deleteUser(created.user.id)
        throw profileError
      }
      return json({ ok: true, account: accountView(profile as Profile) }, 201)
    }

    const userId = String(body.userId ?? '')
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return json({ ok: false, error: 'Invalid account.' }, 400)
    if (userId === caller.id) return json({ ok: false, error: 'You cannot change your own access or password here.' }, 400)

    const { data: target } = await admin.from('profiles').select('id, role').eq('id', userId).maybeSingle()
    if (!target || !['customer', 'staff'].includes(target.role)) return json({ ok: false, error: 'Managed account not found.' }, 404)
    if (caller.role === 'staff' && target.role !== 'customer') return json({ ok: false, error: 'Staff can manage customer accounts only.' }, 403)

    if (body.action === 'set-active') {
      const isActive = body.isActive === true
      const { error } = await admin.from('profiles').update({ is_active: isActive }).eq('id', userId)
      if (error) throw error
      const { error: authError } = await admin.auth.admin.updateUserById(userId, { ban_duration: isActive ? 'none' : '876000h' })
      if (authError) {
        await admin.from('profiles').update({ is_active: !isActive }).eq('id', userId)
        throw authError
      }
      return json({ ok: true })
    }

    if (body.action === 'reset-password') {
      if (!validPassword(body.password)) return json({ ok: false, error: 'Password must be at least 6 characters.' }, 400)
      const { error } = await admin.auth.admin.updateUserById(userId, { password: String(body.password) })
      if (error) throw error
      return json({ ok: true })
    }

    return json({ ok: false, error: 'Unknown action.' }, 400)
  } catch (error) {
    console.error('account-admin failed', error)
    return json({ ok: false, error: 'Account operation failed.' }, 500)
  }
})
