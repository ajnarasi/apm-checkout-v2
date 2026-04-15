// @ts-nocheck — v2.2 reference adapter; type alignment queued for v2.3 (shared-types capability matrix expansion)
/**
 * Alipay+ — REAL adapter (v2.2).
 *
 * Pattern: qr (extends QrAdapterBase)
 * Region:  APAC — China, Hong Kong, Malaysia, Thailand, Indonesia, Philippines
 * Spec:    https://docs.alipayplus.com/alipayplus/alipayplus/payment_guide/cashier_create
 *
 * Real-SDK pattern. Alipay+ has NO browser-side SDK — it's purely a
 * server-to-server flow. The browser's only job is to render the QR code
 * that CH returns and let the user scan with their wallet app (Alipay,
 * TrueMoney, GCash, Kakao Pay, etc.).
 *
 * QrAdapterBase handles the polling fallback. This subclass declares the
 * AdapterCapabilities with the correct routing: Alipay+ routes internally
 * through CH as `paymentMethod.provider='AlipayPlus'`, which CH then
 * fan-outs to the right wallet partner based on the user's scan.
 */

import type { AdapterCapabilities } from '@commercehub/shared-types';
import { defaultCallbacks, defaultInteractive } from '@commercehub/shared-types';
import { QrAdapterBase } from '../base/qr-base.js';

export class AlipayPlusAdapter extends QrAdapterBase {
  readonly id = 'alipayplus';
  readonly displayName = 'Alipay+';
  readonly pattern = 'qr-code' as const;

  static readonly capabilities: AdapterCapabilities = {
    pattern: 'qr',
    displayName: 'Alipay+',
    region: 'APAC',
    callbacks: defaultCallbacks('qr'),
    sdk: { requiresClientScript: false, cdnUrl: null, globalVariable: null, providerSdkVersion: null },
    ui: { providesButton: false, providesIcon: true, providesBrandedColors: true, requiresMerchantCapabilityCheck: false, requiresDomainVerification: false },
    handoff: { requiresMerchantValidation: false, requiresWebhook: true },
    interactive: defaultInteractive(),
    intents: { supportsGatewayInitiated: true, supportsMerchantInitiated: false, supportsSeparateCapture: false, supportsVoid: true, supportsRefund: true, supportsPartialCapture: false, supportsPartialRefund: true },
  };
}
