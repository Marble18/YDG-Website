import { corsHeaders, json } from '../_shared/http.ts'
import { adminClient, publicClient, userClient } from '../_shared/supabase.ts'

type Operator = { id: string; role: 'owner' | 'staff'; is_active: boolean }

async function requireOperator(request: Request) {
  const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data } = await publicClient().auth.getUser(token)
  if (!data.user) return null
  const admin = adminClient()
  const { data: profile } = await admin.from('profiles').select('id,role,is_active').eq('id', data.user.id).maybeSingle()
  if (!profile?.is_active || !['owner', 'staff'].includes(profile.role)) return null
  return { token, admin, caller: profile as Operator }
}

function validId(value: unknown) {
  const id = String(value ?? '')
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : null
}

function exactProductImagePath(value: unknown) {
  if (!value) return null
  try {
    const url = new URL(String(value))
    const expectedHost = new URL(Deno.env.get('SUPABASE_URL')!).host
    const marker = '/storage/v1/object/public/product-images/'
    if (url.host !== expectedHost || !url.pathname.startsWith(marker)) return null
    const path = decodeURIComponent(url.pathname.slice(marker.length))
    if (!path || path.includes('..') || path.includes('\\') || path.includes('\0') || path.startsWith('/')) return null
    return path
  } catch { return null }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' }, 405)
  try {
    const auth = await requireOperator(request)
    if (!auth) return json({ ok: false, code: 'ACCESS_DENIED', message: 'Active owner or staff access is required.' }, 403)
    const body = await request.json()

    if (body.action === 'delete-product') {
      const productId = validId(body.productId)
      if (!productId) return json({ ok: false, code: 'INVALID_PRODUCT', message: 'Select a valid product.' }, 400)
      const { data, error } = await userClient(auth.token).rpc('tombstone_product', { p_product_id: productId })
      if (error) throw error
      const path = exactProductImagePath(data?.image_url)
      if (!data?.image_url || data.image_cleanup_status === 'removed') return json({ ok: true, product: data })
      if (!path) {
        await auth.admin.rpc('mark_product_image_cleanup', { p_product_id: productId, p_status: 'failed', p_error_code: 'UNSAFE_IMAGE_PATH' })
        return json({ ok: true, product: data, cleanupWarning: 'Product was deleted, but its image path was not safe to remove automatically.' })
      }
      const { error: removeError } = await auth.admin.storage.from('product-images').remove([path])
      if (removeError) {
        await auth.admin.rpc('mark_product_image_cleanup', { p_product_id: productId, p_status: 'failed', p_error_code: 'STORAGE_REMOVE_FAILED' })
        return json({ ok: true, product: data, cleanupWarning: 'Product was deleted. Image cleanup can be retried safely.' })
      }
      await auth.admin.rpc('mark_product_image_cleanup', { p_product_id: productId, p_status: 'removed' })
      return json({ ok: true, product: data })
    }

    if (body.action === 'delete-customer') {
      const customerId = validId(body.customerId)
      if (!customerId || customerId === auth.caller.id) return json({ ok: false, code: 'INVALID_CUSTOMER', message: 'Select a valid customer account.' }, 400)
      const { data: target } = await auth.admin.from('profiles').select('id,role').eq('id', customerId).maybeSingle()
      if (target && target.role !== 'customer') return json({ ok: false, code: 'PROTECTED_ACCOUNT', message: 'Owner and staff accounts cannot be deleted here.' }, 403)
      if (!target) {
        const { data: pending } = await auth.admin.from('customer_deletion_requests').select('customer_id,auth_deleted_at').eq('customer_id', customerId).maybeSingle()
        if (!pending) return json({ ok: false, code: 'CUSTOMER_NOT_FOUND', message: 'Customer account was not found.' }, 404)
        if (pending.auth_deleted_at) return json({ ok: true, alreadyDeleted: true })
      }
      const { error: banError } = await auth.admin.auth.admin.updateUserById(customerId, { ban_duration: '876000h' })
      if (banError && !/not found/i.test(banError.message)) throw banError
      const { data: prepared, error: prepareError } = await userClient(auth.token).rpc('prepare_customer_permanent_deletion', { p_customer_id: customerId })
      if (prepareError) throw prepareError
      const { error: authDeleteError } = await auth.admin.auth.admin.deleteUser(customerId)
      if (authDeleteError && !/not found/i.test(authDeleteError.message)) {
        await auth.admin.rpc('complete_customer_auth_deletion', { p_customer_id: customerId, p_success: false, p_error_code: 'AUTH_DELETE_FAILED' })
        return json({ ok: false, code: 'AUTH_DELETE_RETRY_REQUIRED', message: 'Customer data was safely detached and login is disabled, but Auth deletion needs a safe retry.' }, 409)
      }
      await auth.admin.rpc('complete_customer_auth_deletion', { p_customer_id: customerId, p_success: true })
      return json({ ok: true, customer: prepared })
    }

    return json({ ok: false, code: 'UNKNOWN_ACTION', message: 'Unknown deletion action.' }, 400)
  } catch (error) {
    console.error('permanent-delete failed', error instanceof Error ? error.name : 'UNKNOWN')
    return json({ ok: false, code: 'DELETE_OPERATION_FAILED', message: 'The deletion could not be completed safely. Nothing should be retried blindly.' }, 500)
  }
})
