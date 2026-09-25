# UKOM Health Pro — Transactional Email Setup

The payment webhook is already prepared to send a branded confirmation email after a verified Midtrans payment. Payment/subscription activation does **not** depend on email delivery.

## Provider

Current implementation uses **Resend**.

Required Supabase Edge Function secrets:

```text
RESEND_API_KEY
PAYMENT_EMAIL_FROM
```

Admin/payment notification email is configured as:

```text
andazmortin@gmail.com
```

This address is also used as Reply-To for participant payment confirmations.

Do not put either secret in `index.html`, GitHub, commits, screenshots, or chat.

## Recommended setup

1. Create/choose a sending domain in Resend.
2. Verify the domain by adding the DNS records shown by Resend.
3. Create an API key with **Sending access** rather than full account access.
4. Restrict the key to the verified sending domain when available.
5. In Supabase project **UKOM Ners Pro** → Edge Functions → Secrets:
   - add `RESEND_API_KEY`
   - add `PAYMENT_EMAIL_FROM`, for example:
     `UKOM Health Pro <payment@your-verified-domain.example>`
6. Do not change Midtrans Server Key or other payment secrets while configuring email.

## Expected behavior

Verified Midtrans settlement/capture:

```text
Payment verified
   ↓
Subscription activated/extended atomically
   ↓
One email outbox row
   ↓
Email sent if Resend secrets are configured
```

If Resend is unavailable:
- subscription remains valid;
- payment remains valid;
- outbox records the failure for retry;
- email failure never revokes access.

Duplicate Midtrans webhook:
- does not extend the same payment twice;
- does not create duplicate outbox rows;
- does not send a second email after status `sent`.

Historical transactions that were already applied before the email feature existed are not sent surprise delayed emails unless an outbox record already exists.

## Email content

Subject:
`Pembayaran Berhasil — UKOM Health Pro <Program>`

Body includes:
- participant name;
- program;
- payment amount;
- Premium active status;
- expiry date;
- button back to UKOM Health Pro.

## Release test

Use one real controlled payment after Production is ready and verify:

1. `transactions.transaction_status = settlement`
2. `transactions.paid_at` populated
3. `transactions.subscription_applied_at` populated
4. exactly one active/extended subscription
5. exactly one `payment_email_outbox` row
6. outbox status becomes `sent`
7. `transactions.email_sent_at` populated
8. the student receives the branded message
9. admin notification is delivered to `andazmortin@gmail.com`

Never manually mark the transaction or subscription successful during this test.
