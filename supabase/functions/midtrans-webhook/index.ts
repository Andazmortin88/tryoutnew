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

const OWNER_EMAIL = 'amzalmortinandas@gmail.com'
const OWNER_FROM = 'UKOM Health Pro <pembayaran@email.ukom.nursinggeniuscare.co.id>'
const PROGRAM_LABEL: Record<string, string> = {
  ners: 'Profesi Ners', d3: 'D3 Keperawatan', bidan: 'Profesi Bidan',
}

// The payment ledger is authoritative. Email delivery never determines access.
async function notifyOwner(admin: ReturnType<typeof createClient>, trx: {
  id: string; user_id: string; order_id: string; program: string; amount: number;
}) {
  const { data: claimed, error: claimError } = await admin
    .from('payment_owner_notifications')
    .update({ status: 'sending', lease_until: new Date(Date.now() + 5 * 60_000).toISOString(),
      updated_at: new Date().toISOString() })
    .eq('transaction_id', trx.id)
    .in('status', ['pending', 'failed'])
    .select('transaction_id,paid_at,expires_at,recipient_email,attempts')
    .maybeSingle()
  if (claimError) throw claimError
  if (!claimed) return { skipped: true, reason: 'ALREADY_SENT_OR_NOT_READY' }

  const attempts = Number(claimed.attempts || 0) + 1
  const finish = async (status: 'sent' | 'failed' | 'setup_required', extras: Record<string, unknown>) => {
    const { error } = await admin.from('payment_owner_notifications')
      .update({ status, attempts, lease_until: null, updated_at: new Date().toISOString(), ...extras })
      .eq('transaction_id', trx.id).eq('status', 'sending')
    if (error) throw error
  }

  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) {
    await finish('setup_required', { last_error: 'RESEND_API_KEY_MISSING' })
    return { queued: true, sent: false, reason: 'RESEND_NOT_CONFIGURED' }
  }

  try {
    const { data: buyer } = await admin.from('profiles').select('full_name,email').eq('id', trx.user_id).maybeSingle()
    const idr = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })
    const date = (value: string | null) => value ? new Intl.DateTimeFormat('id-ID', {
      dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta',
    }).format(new Date(value)) + ' WIB' : '-'
    const subject = `Pembayaran berhasil — UKOM Health Pro ${PROGRAM_LABEL[trx.program] || trx.program}`
    const body = [
      'Pembayaran langganan UKOM Health Pro telah terverifikasi oleh Midtrans.',
      `Program: ${PROGRAM_LABEL[trx.program] || trx.program}`,
      `Peserta: ${buyer?.full_name || '-'}`,
      `Email peserta: ${buyer?.email || '-'}`,
      `Nominal: ${idr.format(trx.amount)}`,
      `Order ID: ${trx.order_id}`,
      `Dibayar: ${date(claimed.paid_at)}`,
      `Akses hingga: ${date(claimed.expires_at)}`,
      '',
      'Pesan otomatis untuk pemilik UKOM Health Pro; tidak dikirim kepada peserta.',
    ].join('\n')
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: {
        'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json',
        'Idempotency-Key': `ukom-owner-${trx.id}`,
      },
      body: JSON.stringify({ from: OWNER_FROM, to: [OWNER_EMAIL], subject, text: body }),
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok || !result.id) {
      const setup = response.status === 401 || response.status === 403
      await finish(setup ? 'setup_required' : 'failed', {
        last_error: `RESEND_${response.status}: ${JSON.stringify(result).slice(0,350)}`,
      })
      return { queued: true, sent: false, reason: setup ? 'RESEND_DOMAIN_OR_KEY_NOT_READY' : 'RESEND_SEND_FAILED' }
    }
    await finish('sent', { provider_message_id: String(result.id), sent_at: new Date().toISOString(), last_error: null })
    return { queued: true, sent: true }
  } catch (error) {
    await finish('failed', { last_error: String(error).slice(0,350) })
    return { queued: true, sent: false, reason: 'SEND_ERROR' }
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

    // Only a newly granted subscription creates an owner notification. Replayed
    // callbacks may retry an existing outbox entry but cannot create a second one.
    let ownerNotification: Record<string, unknown> = { skipped: true }
    if (verifiedPaid && applied?.paid && !applied?.hold_email && !applied?.review_required) {
      if (applied.idempotent === false) {
        const { data: paidTrx, error: paidError } = await admin.from('transactions')
          .select('paid_at,subscription_applied_at').eq('id', trx.id).single()
        if (paidError || !paidTrx?.paid_at || !paidTrx.subscription_applied_at) {
          console.error('Owner notification payment guard failed:', paidError)
          return json({ error: 'NOTIFICATION_QUEUE_GUARD_FAILED' }, 500)
        }
        const { error: queueError } = await admin.from('payment_owner_notifications').insert({
          transaction_id: trx.id, order_id: trx.order_id, user_id: trx.user_id,
          program: trx.program, amount: trx.amount, recipient_email: OWNER_EMAIL,
          paid_at: paidTrx.paid_at, expires_at: applied.expires_at,
        })
        if (queueError && queueError.code !== '23505') {
          console.error('Owner notification queue error:', queueError)
          return json({ error: 'NOTIFICATION_QUEUE_FAILED' }, 500)
        }
      }
      try {
        ownerNotification = await notifyOwner(admin, trx)
      } catch (notifyError) {
        console.error('Owner notification delivery error:', notifyError)
        ownerNotification = { queued: true, sent: false, reason: 'DELIVERY_PENDING' }
      }
    }

    return json({
      ok: true,
      order_id: orderId,
      paid: verifiedPaid,
      status: transactionStatus,
      applied,
      owner_notification: ownerNotification,
    }, 200)
  } catch (error) {
    console.error(error)
    return json({ error: error?.message || 'INTERNAL_ERROR' }, 500)
  }
})
