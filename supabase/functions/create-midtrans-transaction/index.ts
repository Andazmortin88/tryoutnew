import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

function makeCors(req: Request, appUrl: string) {
  const appOrigin = new URL(appUrl).origin
  const origin = req.headers.get('Origin')
  const allowed = !origin || origin === appOrigin
  return {
    allowed,
    headers: {
      'Access-Control-Allow-Origin': origin && allowed ? origin : appOrigin,
      'Vary': 'Origin',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Max-Age': '86400',
    },
  }
}

function json(body: unknown, status = 200, headers: Record<string,string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

Deno.serve(async (req) => {
  const appUrl = Deno.env.get('APP_URL') || 'https://andazmortin88.github.io/tryoutnew/'
  const cors = makeCors(req, appUrl)

  if (!cors.allowed) return json({ error: 'ORIGIN_NOT_ALLOWED' }, 403, cors.headers)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors.headers })
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405, cors.headers)

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const midtransServerKey = Deno.env.get('MIDTRANS_SERVER_KEY')
    const isProduction = (Deno.env.get('MIDTRANS_IS_PRODUCTION') || 'false').toLowerCase() === 'true'

    if (!midtransServerKey) return json({ error: 'MIDTRANS_SERVER_KEY_NOT_CONFIGURED' }, 500, cors.headers)

    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    if (!token) return json({ error: 'AUTH_REQUIRED' }, 401, cors.headers)

    const admin = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: userData, error: userError } = await admin.auth.getUser(token)
    const user = userData?.user
    if (userError || !user) return json({ error: 'INVALID_SESSION' }, 401, cors.headers)

    const body = await req.json().catch(() => ({}))
    const program = String(body?.program || '')
    const plan = String(body?.plan || 'launch_30')
    const labels: Record<string,string> = {
      ners: 'Profesi Ners',
      d3: 'D3 Keperawatan',
      bidan: 'Profesi Bidan',
    }

    if (!Object.prototype.hasOwnProperty.call(labels, program)) {
      return json({ error: 'INVALID_PROGRAM' }, 400, cors.headers)
    }
    if (plan !== 'launch_30') return json({ error: 'INVALID_PLAN' }, 400, cors.headers)

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('full_name,email,institution,program')
      .eq('id', user.id)
      .maybeSingle()

    if (profileError || !profile) return json({ error: 'PROFILE_NOT_FOUND' }, 400, cors.headers)
    if (profile.program !== program) return json({ error: 'PROGRAM_MISMATCH' }, 400, cors.headers)

    // Atomically reserve or reuse one checkout row for this user/program.
    const requestId = String(body?.request_id || crypto.randomUUID())
    const { data: reserved, error: reserveError } = await admin.rpc('reserve_checkout_order', {
      p_user_id: user.id,
      p_program: program,
      p_plan: plan,
      p_request_id: requestId,
    })

    if (reserveError) {
      const msg = String(reserveError.message || '')
      if (msg.includes('CHECKOUT_RATE_LIMIT')) {
        return json({ error: 'PAYMENT_RATE_LIMIT', retry_after_seconds: 3600 }, 429, cors.headers)
      }
      console.error('Checkout reservation failed:', reserveError)
      return json({ error: 'PAYMENT_RESERVATION_FAILED' }, 500, cors.headers)
    }

    let reservedRedirect = reserved?.redirect_url || null

    // A parallel request may arrive while the first request is still creating Snap.
    // Wait briefly and reuse the same transaction instead of creating a duplicate order.
    if (reserved?.reused && reserved?.in_progress && !reservedRedirect) {
      for (let i = 0; i < 6 && !reservedRedirect; i++) {
        await new Promise(resolve => setTimeout(resolve, 300))
        const { data: pendingRow } = await admin
          .from('transactions')
          .select('raw_response,transaction_status')
          .eq('id', reserved.transaction_id)
          .maybeSingle()
        reservedRedirect = pendingRow?.raw_response?.redirect_url || null
        if (pendingRow?.transaction_status === 'create_failed') break
      }
    }

    if (reserved?.reused && reservedRedirect) {
      return json({
        order_id: reserved.order_id,
        redirect_url: reservedRedirect,
        amount: Number(reserved.amount),
        program,
        reused: true,
      }, 200, cors.headers)
    }

    if (reserved?.reused && !reservedRedirect) {
      return json({ error: 'CHECKOUT_IN_PROGRESS', retry_after_ms: 1200 }, 409, cors.headers)
    }

    const amount = Number(reserved.amount)
    const orderId = String(reserved.order_id)

    const snapUrl = isProduction
      ? 'https://app.midtrans.com/snap/v1/transactions'
      : 'https://app.sandbox.midtrans.com/snap/v1/transactions'

    const notificationUrl = `${supabaseUrl}/functions/v1/midtrans-webhook`
    const basicAuth = btoa(`${midtransServerKey}:`)

    const payload = {
      transaction_details: { order_id: orderId, gross_amount: amount },
      item_details: [{
        id: `ukom-${program}-launch30`,
        price: amount,
        quantity: 1,
        name: `UKOM Health Pro - ${labels[program]} 30 Hari`,
      }],
      customer_details: {
        first_name: profile.full_name || user.user_metadata?.full_name || 'Mahasiswa',
        email: profile.email || user.email,
      },
      callbacks: { finish: appUrl },
      custom_field1: user.id,
      custom_field2: program,
      custom_field3: plan,
    }

    const response = await fetch(snapUrl, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Basic ${basicAuth}`,
        'X-Override-Notification': notificationUrl,
      },
      body: JSON.stringify(payload),
    })

    const snap = await response.json().catch(() => ({}))

    if (!response.ok || !snap?.redirect_url) {
      await admin.from('transactions').update({
        transaction_status: 'create_failed',
        raw_response: snap,
      }).eq('order_id', orderId).eq('transaction_status', 'creating')

      return json({ error: 'MIDTRANS_CREATE_FAILED' }, 502, cors.headers)
    }

    await admin.from('transactions').update({
      transaction_status: 'pending',
      raw_response: snap,
    }).eq('order_id', orderId).eq('transaction_status', 'creating')

    return json({
      order_id: orderId,
      redirect_url: snap.redirect_url,
      amount,
      program,
    }, 200, cors.headers)
  } catch (error) {
    console.error(error)
    return json({ error: error?.message || 'INTERNAL_ERROR' }, 500, cors.headers)
  }
})