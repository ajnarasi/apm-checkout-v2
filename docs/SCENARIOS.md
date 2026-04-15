# Scenarios — Given/When/Then per APM Pattern

Executable specifications. The `pattern-scenarios.test.ts` file in `checkout-sdk-browser/test/` asserts each of these.

## Pattern 1 — server-bnpl (Klarna)

```
Given a Klarna config:
  apm = "klarna"
  amount = { value: 49.99, currency: "USD" }
  credentials.providerClientToken = "klarna-ct-xyz"
  containerId = "klarna-container"

When checkout.init() is called
Then PAYMENT_METHOD_READY fires within 2 seconds
And the Klarna SDK script is loaded from x.klarnacdn.net
And Klarna.Payments.init({ client_token }) is called with providerClientToken

When checkout.authorize() is called
And Klarna.Payments.authorize() resolves with { approved: true, authorization_token: "kat-1" }
Then sessionClient.authorizeOrder() is called with providerData = { authorization_token: "kat-1" }
And PAYMENT_AUTHORIZED fires
And PAYMENT_COMPLETED fires with result.status = "captured"
```

## Pattern 2 — redirect-wallet (PayPal)

```
Given a PayPal config:
  apm = "paypal"
  amount = { value: 49.99, currency: "USD" }
  returnUrls = { successUrl, cancelUrl }

When checkout.authorize() is called
Then sessionClient.authorizeOrder() returns OrderResult with:
  status = "pending_authorization"
  nextAction = { kind: "redirect", redirectUrl: "https://provider.example.com/auth?..." }
And REDIRECT_REQUIRED fires with redirectUrl
And PAYMENT_PENDING fires with orderId

When the webhook arrives:
  POST /v2/webhooks/paypal { sessionId, orderId, kind: "payment.succeeded" }
Then SSE relays the envelope to the browser
And the WebhookListener drives the state machine: pending → completed
And PAYMENT_COMPLETED fires
```

## Pattern 3 — bank-redirect (iDEAL)

```
Given an iDEAL config (PPRO-routed):
  apm = "ideal"
  amount = { value: 30.00, currency: "EUR" }
  returnUrls = { successUrl, cancelUrl }

When checkout.authorize() is called
Then sessionClient.authorizeOrder() returns:
  status = "pending_authorization"
  nextAction = { kind: "redirect", redirectUrl }
And the PPRO factory adapter starts polling sessionClient.getOrder() every 5s as a webhook fallback
And REDIRECT_REQUIRED fires
And PAYMENT_PENDING fires

When the webhook arrives first:
Then state machine transitions pending → completed
And the polling loop is stopped on next tick

When the polling sees status="captured" first (webhook was lost):
Then state machine transitions pending → completed
And both paths produce exactly one PAYMENT_COMPLETED event (state machine deduplicates)
```

## Pattern 4 — qr-code (Alipay+)

```
Given an Alipay+ config:
  apm = "alipayplus"
  amount = { value: 49.99, currency: "USD" }

When checkout.authorize() is called
Then sessionClient.authorizeOrder() returns:
  status = "pending_authorization"
  nextAction = { kind: "qr_code", qrCodeData: "00020101..." }
And PAYMENT_PENDING fires

(The merchant frontend renders the QR; user scans with their wallet.)

When the webhook arrives:
Then PAYMENT_COMPLETED fires
```

## Pattern 5 — voucher-cash (Boleto)

```
Given a Boleto config:
  apm = "boleto"
  amount = { value: 100.00, currency: "BRL" }
  customer.firstName, customer.lastName required

When checkout.authorize() is called
Then OrderResult.nextAction = { kind: "display_voucher", voucherNumber, voucherUrl }
And PAYMENT_PENDING fires
And the merchant frontend displays the voucher number for the user to pay at their bank

When the webhook arrives 1-3 days later:
Then PAYMENT_COMPLETED fires (provided the SSE connection or replay buffer is still alive)
```

## Pattern 6 — native-wallet (Apple Pay)

```
Given an Apple Pay config:
  apm = "applepay"
  amount = { value: 49.99, currency: "USD" }

When checkout.init() is called in a browser without ApplePaySession
Then ConfigValidationError is thrown: "Apple Pay is not available in this browser"

When checkout.init() is called in Safari with Apple Pay available
And checkout.authorize() is called
Then sessionClient.authorizeOrder() is called synchronously (no webhook listener mounted)
And PAYMENT_AUTHORIZED fires
And PAYMENT_COMPLETED fires within 1 second
And NO SSE connection is opened (native-wallet pattern is sync only)
```
