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

function programLabel(program: string) {
  if (program === 'd3') return 'D3 Keperawatan'
  if (program === 'bidan') return 'Profesi Bidan'
  return 'Profesi Ners'
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
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

async function sendAdminPaymentEmail(admin: any, mail: any, resendKey: string, fromEmail: string, adminEmail: string) {
  if (mail.admin_status === 'sent') return { sent: true, skipped: true }

  const label = programLabel(mail.program)
  const expiry = mail.expires_at
    ? new Date(mail.expires_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' })
    : '30 hari sejak aktivasi'
  const rupiah = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(mail.amount || 0))
  const safeName = escapeHtml(mail.recipient_name || 'Peserta UKOM')
  const safeEmail = escapeHtml(mail.recipient_email || '')
  const safeLabel = escapeHtml(label)
  const safeExpiry = escapeHtml(expiry)
  const safeRupiah = escapeHtml(rupiah)

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `payment-admin/${mail.transaction_id}`,
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [adminEmail],
      reply_to: mail.recipient_email,
      subject: `Pembayaran masuk — UKOM Health Pro ${label}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#0f172a">
        <h2>UKOM Health Pro — Pembayaran masuk</h2>
        <p><strong>Program:</strong> ${safeLabel}</p>
        <p><strong>Peserta:</strong> ${safeName}</p>
        <p><strong>Email:</strong> ${safeEmail}</p>
        <p><strong>Nominal:</strong> ${safeRupiah}</p>
        <p><strong>Premium aktif sampai:</strong> ${safeExpiry}</p>
      </div>`,
    }),
  })

  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    await admin.from('payment_email_outbox').update({
      admin_status: 'failed',
      admin_last_error: JSON.stringify(body).slice(0, 2000),
    }).eq('id', mail.id)
    return { sent: false, status: response.status }
  }

  await admin.from('payment_email_outbox').update({
    admin_status: 'sent',
    admin_provider_message_id: body?.id || null,
    admin_last_error: null,
    admin_sent_at: new Date().toISOString(),
  }).eq('id', mail.id)

  return { sent: true, provider_id: body?.id || null }
}

async function trySendPaymentEmail(admin: any, transactionId: string) {
  const resendKey = Deno.env.get('RESEND_API_KEY')
  const fromEmail = Deno.env.get('PAYMENT_EMAIL_FROM')
  const adminEmail = Deno.env.get('PAYMENT_ADMIN_EMAIL') || 'andazmortin@gmail.com'
  const appUrl = Deno.env.get('APP_URL') || 'https://andazmortin88.github.io/tryoutnew/'

  if (!resendKey || !fromEmail) return { configured: false }

  const { data: current, error: currentError } = await admin
    .from('payment_email_outbox')
    .select('*')
    .eq('transaction_id', transactionId)
    .maybeSingle()

  if (currentError) throw currentError
  if (!current) return { configured: true, skipped: true, reason: 'OUTBOX_NOT_FOUND' }

  // Participant email may already be sent while admin notification still needs a retry.
  if (current.status === 'sent') {
    const adminResult = await sendAdminPaymentEmail(admin, current, resendKey, fromEmail, adminEmail)
    return { configured: true, sent: true, skipped: true, admin: adminResult }
  }

  const { data: claimed, error: claimError } = await admin.rpc('claim_payment_email', {
    p_transaction_id: transactionId,
  })
  if (claimError) throw claimError

  if (!claimed?.id) {
    return { configured: true, skipped: true, reason: 'EMAIL_ALREADY_CLAIMED' }
  }

  const mail = claimed
  const label = programLabel(mail.program)
  const expiry = mail.expires_at
    ? new Date(mail.expires_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' })
    : '30 hari sejak aktivasi'
  const rupiah = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(mail.amount || 0))
  const safeName = escapeHtml(mail.recipient_name || 'Peserta UKOM')
  const safeLabel = escapeHtml(label)
  const safeExpiry = escapeHtml(expiry)
  const safeRupiah = escapeHtml(rupiah)
  const safeAppUrl = escapeHtml(appUrl)

  const html = `
  <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#0f172a">
    <div style="background:#0369a1;color:white;padding:24px;border-radius:18px 18px 0 0">
      <h1 style="margin:0;font-size:24px">UKOM Health Pro</h1>
      <p style="margin:8px 0 0;color:#e0f2fe">Pembayaran berhasil</p>
    </div>
    <div style="padding:24px;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 18px 18px">
      <p>Halo <strong>${safeName}</strong>,</p>
      <p>Pembayaran Anda telah berhasil diverifikasi dan akses Premium sudah aktif.</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0">
        <tr><td style="padding:8px 0;color:#64748b">Program</td><td style="padding:8px 0;text-align:right;font-weight:700">${safeLabel}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Pembayaran</td><td style="padding:8px 0;text-align:right;font-weight:700">${safeRupiah}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Status</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#047857">Premium Aktif</td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Aktif sampai</td><td style="padding:8px 0;text-align:right;font-weight:700">${safeExpiry}</td></tr>
      </table>
      <a href="${safeAppUrl}" style="display:inline-block;background:#0369a1;color:white;text-decoration:none;padding:13px 20px;border-radius:10px;font-weight:700">Mulai Belajar</a>
      <p style="margin-top:24px;font-size:12px;color:#64748b">Email ini dikirim otomatis setelah pembayaran terverifikasi oleh sistem UKOM Health Pro.</p>
    </div>
  </div>`

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `payment-success/${mail.transaction_id}`,
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [mail.recipient_email],
      reply_to: adminEmail,
      subject: `Pembayaran Berhasil — UKOM Health Pro ${label}`,
      html,
    }),
  })

  const body = await response.json().catch(() => ({}))

  if (!response.ok) {
    await admin.from('payment_email_outbox').update({
      status: 'failed',
      lease_until: null,
      last_error: JSON.stringify(body).slice(0, 2000),
    }).eq('id', mail.id)
    return { configured: true, sent: false, status: response.status }
  }

  await admin.from('payment_email_outbox').update({
    status: 'sent',
    provider_message_id: body?.id || null,
    last_error: null,
    sent_at: new Date().toISOString(),
    lease_until: null,
  }).eq('id', mail.id)

  await admin.from('transactions').update({
    email_sent_at: new Date().toISOString(),
  }).eq('id', mail.transaction_id)

  const updatedMail = { ...mail, status: 'sent', provider_message_id: body?.id || null }
  const adminResult = await sendAdminPaymentEmail(admin, updatedMail, resendKey, fromEmail, adminEmail)

  return { configured: true, sent: true, provider_id: body?.id || null, admin: adminResult }
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

    let email = { configured: false } as any
    if (verifiedPaid) {
      const { data: existingOutbox, error: existingOutboxError } = await admin
        .from('payment_email_outbox')
        .select('id,status')
        .eq('transaction_id', trx.id)
        .maybeSingle()

      if (existingOutboxError) {
        console.error('Email outbox lookup failed:', existingOutboxError)
      }

      // New payments may create an outbox row. For historical transactions that
      // were already applied before the email feature existed, do not suddenly
      // send a delayed confirmation unless an outbox row already exists.
      const shouldHandleEmail = !trx.subscription_applied_at || !!existingOutbox

      if (shouldHandleEmail) {
        const expiresAt = applied?.expires_at || null
        const { error: queueError } = await admin.rpc('queue_payment_success_email', {
          p_transaction_id: trx.id,
          p_expires_at: expiresAt,
        })

        if (queueError) {
          console.error('Email queue failed:', queueError)
        } else {
          try {
            email = await trySendPaymentEmail(admin, trx.id)
          } catch (emailError) {
            console.error('Payment email send failed:', emailError)
          }
        }
      } else {
        email = { configured: false, skipped: true, reason: 'HISTORICAL_PAYMENT_ALREADY_APPLIED' }
      }
    }

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