import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

async function sha512(text: string) {
  const bytes = new TextEncoder().encode(text)
  const hash = await crypto.subtle.digest('SHA-512', bytes)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function parseMoneyMinor(value: string) {
  const s = String(value || '').trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(s)) return null
  const [whole, frac = ''] = s.split('.')
  const cents = (frac + '00').slice(0, 2)
  try {
    return BigInt(whole) * 100n + BigInt(cents)
  } catch {
    return null
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const serverKey = Deno.env.get('MIDTRANS_SERVER_KEY')
    if (!serverKey) return json({ error: 'MIDTRANS_SERVER_KEY_NOT_CONFIGURED' }, 500)

    const payload = await req.json().catch(() => null)
    if (!payload) return json({ error: 'INVALID_JSON' }, 400)

    const orderId = String(payload.order_id || '')
    const statusCode = String(payload.status_code || '')
    const grossAmount = String(payload.gross_amount || '')
    const signature = String(payload.signature_key || '')

    if (!orderId || !statusCode || !grossAmount || !signature) {
      return json({ error: 'INVALID_PAYLOAD' }, 400)
    }

    const expected = await sha512(orderId + statusCode + grossAmount + serverKey)
    if (expected.toLowerCase() !== signature.toLowerCase()) {
      return json({ error: 'INVALID_SIGNATURE' }, 401)
    }

    const admin = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: trx, error: trxError } = await admin
      .from('transactions')
      .select('id,user_id,order_id,program,amount,subscription_applied_at')
      .eq('order_id', orderId)
      .maybeSingle()

    if (trxError) {
      console.error('Transaction lookup error:', trxError)
      return json({ error: 'TRANSACTION_LOOKUP_FAILED' }, 500)
    }

    if (!trx) {
      return json({ ok: true, ignored: true, reason: 'ORDER_NOT_FOUND', order_id: orderId }, 200)
    }

    const notifiedMinor = parseMoneyMinor(grossAmount)
    const expectedMinor = BigInt(Number(trx.amount)) * 100n
    if (notifiedMinor === null || notifiedMinor !== expectedMinor) {
      return json({ error: 'AMOUNT_MISMATCH' }, 400)
    }

    // Verify signed webhook state directly against Midtrans before granting access.
    const isProduction = (Deno.env.get('MIDTRANS_IS_PRODUCTION') || 'false').toLowerCase() === 'true'
    const apiBase = isProduction ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com'
    const statusResponse = await fetch(`${apiBase}/v2/${encodeURIComponent(orderId)}/status`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Basic ${btoa(`${serverKey}:`)}`,
      },
    })
    const statusPayload = await statusResponse.json().catch(() => ({}))

    if (!statusResponse.ok) {
      console.error('Midtrans status verification failed:', statusResponse.status, statusPayload)
      return json({ error: 'MIDTRANS_STATUS_VERIFY_FAILED' }, 502)
    }

    if (String(statusPayload.order_id || '') !== orderId) {
      return json({ error: 'MIDTRANS_STATUS_ORDER_MISMATCH' }, 409)
    }

    const statusMinor = parseMoneyMinor(String(statusPayload.gross_amount || ''))
    if (statusMinor === null || statusMinor !== expectedMinor) {
      return json({ error: 'MIDTRANS_STATUS_AMOUNT_MISMATCH' }, 409)
    }

    const transactionStatus = String(statusPayload.transaction_status || '').toLowerCase()
    const fraudStatus = String(statusPayload.fraud_status || '').toLowerCase()
    const verifiedPaid =
      String(statusPayload.status_code || '') === '200' &&
      ['settlement', 'capture'].includes(transactionStatus) &&
      (!fraudStatus || fraudStatus === 'accept')

    const effectiveStatus = verifiedPaid
      ? transactionStatus
      : (['settlement','capture'].includes(transactionStatus)
          ? 'unverified_' + transactionStatus
          : (transactionStatus || 'unknown'))

    const canonicalPayload = { ...statusPayload, _notification: payload }

    const { data: applied, error: applyError } = await admin.rpc('apply_paid_midtrans_transaction', {
      p_order_id: orderId,
      p_transaction_status: effectiveStatus,
      p_payment_method: statusPayload.payment_type || payload.payment_type || null,
      p_gateway_transaction_id: statusPayload.transaction_id || payload.transaction_id || null,
      p_raw_response: canonicalPayload,
    })

    if (applyError) {
      console.error('Atomic payment apply failed:', applyError)
      return json({ error: 'PAYMENT_APPLY_FAILED' }, 500)
    }

    // Payment entitlement is applied above; email notifications are disabled.
    const email = { configured: false, skipped: true, reason: 'PAYMENT_EMAIL_DISABLED' }

    return json({
      ok: true,
      order_id: orderId,
      paid: verifiedPaid,
      status: transactionStatus,
      applied,
      email,
    }, 200)
  } catch (error) {
    console.error(error)
    return json({ error: error?.message || 'INTERNAL_ERROR' }, 500)
  }
})