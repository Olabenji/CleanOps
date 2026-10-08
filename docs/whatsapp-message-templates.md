# WhatsApp message templates

Submit these three templates in the Twilio Content Template Builder as **Utility** templates, in English. The names below are the CleanOps kinds. Meta/Twilio will issue an `HX…` content SID for each one. Put those SIDs in the edge-function secrets listed here. Do not edit a template after it is submitted; Meta treats the wording as fixed.

`dispatch-resident-comms` sends `ContentSid` and `ContentVariables`. It does not send free-form `Body` text. If a SID is missing, WhatsApp is skipped and the message falls back to SMS when the resident has SMS consent.

Template names stay `payment_reminder`, `payment_receipt`, and `suspension_notice`. Variable order is unchanged from migration 0075. The only wording change from that migration is the currency token: the literal `NGN ` replaces the naira sign in both the SMS text and the WhatsApp template. The amount variable is still the number on its own (`5,000`); `NGN ` is fixed template text, so the SMS fallback stays in the GSM-7 alphabet. The same wording is stored for WhatsApp and SMS.

Variable positions are 1-based, in this order:

| Template | Secret | Variables |
|---|---|---|
| `payment_reminder` | `TWILIO_CONTENT_SID_PAYMENT_REMINDER` | 1 name, 2 period, 3 amount, 4 due date |
| `payment_receipt` | `TWILIO_CONTENT_SID_PAYMENT_RECEIPT` | 1 name, 2 amount, 3 method, 4 date, 5 reference |
| `suspension_notice` | `TWILIO_CONTENT_SID_SUSPENSION_NOTICE` | 1 name, 2 reason |

## payment_reminder

```
Hi {{1}}, your CleanOps waste collection tag for {{2}} has NGN {{3}} outstanding. Please pay by {{4}} to keep service active.
```

Sample: `{{1}}` Ada Obi, `{{2}}` October 2026, `{{3}}` 5,000, `{{4}}` 31 Oct 2026.

## payment_receipt

```
Hi {{1}}, we received NGN {{2}} via {{3}} on {{4}}. Ref: {{5}}. Thank you for keeping your CleanOps service current.
```

Sample: `{{1}}` Ada Obi, `{{2}}` 5,000, `{{3}}` paystack, `{{4}}` 08 Oct 2026 14:30, `{{5}}` PAY-123.

## suspension_notice

```
Hi {{1}}, your CleanOps waste collection service has been suspended. Reason: {{2}}. Pay your outstanding tag to restore collection.
```

Sample: `{{1}}` Ada Obi, `{{2}}` Outstanding monthly balance unpaid.

## Consent

WhatsApp and SMS notices are sent only when `resident_message_consent` grants that channel. Operators record the choice on the customer form. A signed-in resident can change it on the web portal and in the mobile app. Phone OTP for sign-in does not use this consent.
