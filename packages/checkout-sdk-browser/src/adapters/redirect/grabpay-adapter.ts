// @ts-nocheck — v2.2 reference adapter; type alignment queued for v2.3 (shared-types capability matrix expansion)
/**
 * GrabPay — REAL adapter (v2.2).
 *
 * Pattern: redirect (extends RedirectAdapterBase)
 * Region:  SG, MY, ID, PH, TH, VN
 * Spec:    https://developer.grab.com/docs/grabpay/
 *
 * GrabPay uses a hosted payment page redirect flow. The merchant frontend
 * navigates the user to the URL returned by CH in
 * `nextAction.url`. On completion Grab redirects back with query params;
 * terminal state arrives via webhook.
 *
 * Note: some GrabPay integrations use QR for in-app wallet scanning. In
 * v2.2 we model the web redirect flow. The QR flow is a different adapter.
 */

import type { AdapterCapabilities } from '@commercehub/shared-types';
import { defaultCallbacks, defaultInteractive } from '@commercehub/shared-types';
import { RedirectAdapterBase } from '../base/redirect-base.js';

export class GrabPayAdapter extends RedirectAdapterBase {
  readonly id = 'grabpay';
  readonly displayName = 'GrabPay';
  readonly pattern = 'redirect-wallet' as const;

  static readonly capabilities: AdapterCapabilities = {
    pattern: 'redirect',
    displayName: 'GrabPay',
    region: 'APAC',
    callbacks: defaultCallbacks('redirect'),
    sdk: { requiresClientScript: false, cdnUrl: null, globalVariable: null, providerSdkVersion: null },
    ui: { providesButton: false, providesIcon: true, providesBrandedColors: true, requiresMerchantCapabilityCheck: false, requiresDomainVerification: false },
    handoff: { requiresMerchantValidation: false, requiresWebhook: true },
    interactive: defaultInteractive(),
    intents: { supportsGatewayInitiated: true, supportsMerchantInitiated: false, supportsSeparateCapture: false, supportsVoid: true, supportsRefund: true, supportsPartialCapture: false, supportsPartialRefund: true },
  };
}
