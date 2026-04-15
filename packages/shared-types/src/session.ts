/**
 * Session response returned by the merchant backend to the frontend
 * after a successful call to Commerce Hub's Credentials API.
 *
 * This is the ONLY shape that crosses the network between the
 * reference server's POST /v2/sessions and the browser SDK's
 * createCheckout({ credentials: { accessToken } }) entry point.
 */

import type { PaymentInitiator } from './intent.js';

export interface SessionResponse {
  /** Bearer token used in Authorization header for subsequent orders calls. */
  accessToken: string;
  /** Opaque session identifier — used for correlation and webhook routing. */
  sessionId: string;
  /** Unix epoch ms when the access token stops being valid. */
  expiresAt: number;
  /**
   * Optional provider-specific client token (e.g. Klarna client_token,
   * PayPal client-id, Alipay+ SDK token). Passed through from Commerce Hub's
   * Credentials response. Widget APMs use this to bootstrap their embedded UI.
   */
  providerClientToken?: string;
  /** The APM this session was created for. */
  apm: string;
  /** The currency the session is denominated in (ISO 4217). */
  currency: string;
  /** The amount in the smallest currency unit (cents). */
  amountMinor: number;
  /**
   * Payment initiator — controls whether the SDK's authorize() does a SALE
   * (gateway-initiated) or stops at AUTHORIZE and waits for the merchant to
   * call capture() (merchant-initiated).
   *
   * Set by the merchant backend when calling CH `/checkouts/v1/orders` and
   * forwarded to the browser via this session response. Defaults to GATEWAY
   * if omitted.
   */
  paymentInitiator?: PaymentInitiator;
}
