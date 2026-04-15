// @ts-nocheck — v2.2 reference adapter; type alignment queued for v2.3 (shared-types capability matrix expansion)
/**
 * WeChat Pay — REAL adapter (v2.2).
 *
 * Pattern: qr (extends QrAdapterBase)
 * Region:  China, Hong Kong
 * Spec:    https://pay.weixin.qq.com/wiki/doc/api/index.html
 *
 * Real-SDK pattern. WeChat Pay has multiple flows:
 *   - Native (QR code scanned by WeChat app)  ← this adapter
 *   - JSAPI (inside WeChat in-app browser)
 *   - H5 (mobile web → WeChat redirect)
 *
 * For the web harness we model the Native QR flow. CH returns a
 * `weixin://wxpay/bizpayurl?pr=...` URI that the browser must encode as
 * a QR code for the user to scan. Merchant frontend renders the QR.
 *
 * Terminal state arrives exclusively via webhook (CH → merchant). Polling
 * fallback runs in QrAdapterBase.
 */

import type { AdapterCapabilities } from '@commercehub/shared-types';
import { defaultCallbacks, defaultInteractive } from '@commercehub/shared-types';
import { QrAdapterBase } from '../base/qr-base.js';

export class WeChatPayAdapter extends QrAdapterBase {
  readonly id = 'wechatpay';
  readonly displayName = 'WeChat Pay';
  readonly pattern = 'qr-code' as const;

  static readonly capabilities: AdapterCapabilities = {
    pattern: 'qr',
    displayName: 'WeChat Pay',
    region: 'APAC',
    callbacks: defaultCallbacks('qr'),
    sdk: { requiresClientScript: false, cdnUrl: null, globalVariable: null, providerSdkVersion: null },
    ui: { providesButton: false, providesIcon: true, providesBrandedColors: true, requiresMerchantCapabilityCheck: false, requiresDomainVerification: false },
    handoff: { requiresMerchantValidation: false, requiresWebhook: true },
    interactive: defaultInteractive(),
    intents: { supportsGatewayInitiated: true, supportsMerchantInitiated: false, supportsSeparateCapture: false, supportsVoid: true, supportsRefund: true, supportsPartialCapture: false, supportsPartialRefund: true },
  };
}
