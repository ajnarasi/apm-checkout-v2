// @ts-nocheck — v2.2 reference adapter; type alignment queued for v2.3 (shared-types capability matrix expansion)
/**
 * Zepto PayTo — REAL adapter (v2.2).
 *
 * Pattern: redirect (extends RedirectAdapterBase)
 * Region:  AU (Zepto is an Australian PayTo originator)
 * Spec:    https://zepto.com.au/docs/payto
 *
 * Zepto is Australia's NPP real-time payments rail. The flow is a
 * standing-authority (PayTo agreement) where the merchant creates an
 * agreement, the user approves it in their banking app, and subsequent
 * charges happen without per-transaction authorization.
 *
 * For v2.2 we model the AGREEMENT CREATION flow: browser forwards order,
 * backend creates Zepto agreement via CH, returns a URL/QR for the user
 * to approve in their banking app. Terminal state arrives via webhook.
 *
 * Once the agreement is approved, subsequent merchant-initiated debits
 * use the stored agreementId. This adapter only handles the first-time
 * agreement creation; subsequent charges are server-only.
 */

import type { AdapterCapabilities } from '@commercehub/shared-types';
import { defaultCallbacks, defaultInteractive } from '@commercehub/shared-types';
import { RedirectAdapterBase } from '../base/redirect-base.js';

export class ZeptoAdapter extends RedirectAdapterBase {
  readonly id = 'zepto';
  readonly displayName = 'Zepto PayTo';
  readonly pattern = 'bank-redirect' as const;

  static readonly capabilities: AdapterCapabilities = {
    pattern: 'redirect',
    displayName: 'Zepto PayTo',
    region: 'APAC',
    callbacks: defaultCallbacks('redirect'),
    sdk: { requiresClientScript: false, cdnUrl: null, globalVariable: null, providerSdkVersion: null },
    ui: { providesButton: false, providesIcon: true, providesBrandedColors: true, requiresMerchantCapabilityCheck: false, requiresDomainVerification: false },
    handoff: { requiresMerchantValidation: false, requiresWebhook: true },
    interactive: defaultInteractive(),
    intents: { supportsGatewayInitiated: true, supportsMerchantInitiated: true, supportsSeparateCapture: true, supportsVoid: true, supportsRefund: true, supportsPartialCapture: false, supportsPartialRefund: true },
  };
}
