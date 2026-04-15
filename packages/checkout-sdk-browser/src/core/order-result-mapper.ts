/**
 * Anti-Corruption Layer: Commerce Hub wire shape → OrderResult domain type.
 *
 * This is the ONLY file in the browser SDK that knows Commerce Hub's
 * orders-endpoint response shape. Adapters consume OrderResult, not
 * the raw CH payload. If Commerce Hub changes their orders API contract,
 * exactly one file changes — not 55.
 *
 * The mapping is deliberately permissive — we normalize many possible
 * CH `transactionState` values into our 6 canonical OrderStatus values.
 */

import type { NextAction, OrderError, OrderResult, OrderStatus } from '@commercehub/shared-types';

/** Shape of what we EXPECT from CH orders endpoint. Deliberately loose. */
export interface CHOrderWireShape {
  gatewayResponse?: {
    transactionState?: string;
    transactionType?: string;
    transactionProcessingDetails?: {
      orderId?: string;
      transactionId?: string;
      apiTraceId?: string;
    };
  };
  paymentReceipt?: {
    approvedAmount?: { total?: number; currency?: string };
    processorResponseDetails?: {
      approvalCode?: string;
      hostResponseMessage?: string;
    };
  };
  /** Some APMs return an authorization_url at the top level. */
  authorization_url?: string;
  authorizationUrl?: string;
  redirectUrl?: string;
  /** QR code data (Alipay+, WeChat Pay). */
  qrCode?: { data?: string; expiresAt?: number };
  /** Voucher data (Boleto, OXXO). */
  voucher?: { number?: string; url?: string };
  error?: Array<{ type?: string; code?: string; message?: string }>;
  [key: string]: unknown;
}

/**
 * Map a CH orders-endpoint response into the adapter-facing domain type.
 */
export function mapOrderResult(wire: CHOrderWireShape): OrderResult {
  const gw = wire.gatewayResponse;
  const details = gw?.transactionProcessingDetails;
  const orderId = details?.orderId ?? 'unknown';
  const transactionId = details?.transactionId;
  const apiTraceId = details?.apiTraceId;

  const status = mapStatus(gw?.transactionState);
  const nextAction = mapNextAction(wire);

  const result: OrderResult = {
    orderId,
    transactionId,
    status,
    nextAction,
    message: wire.paymentReceipt?.processorResponseDetails?.hostResponseMessage,
  };

  if (status === 'declined' || status === 'failed') {
    result.error = mapError(wire, apiTraceId);
  }

  return result;
}

/**
 * Map a CH `transactionState` string to our canonical OrderStatus.
 * Unknown values become 'failed' so they surface as errors, not silently success.
 */
function mapStatus(transactionState?: string): OrderStatus {
  if (!transactionState) return 'failed';
  const normalized = transactionState.toUpperCase();

  switch (normalized) {
    case 'AUTHORIZED':
    case 'APPROVED':
    case 'CAPTURED_SUCCESSFUL':
      return 'authorized';
    case 'CAPTURED':
    case 'SETTLED':
    case 'COMPLETED':
      return 'captured';
    case 'PENDING':
    case 'AUTHORIZATION_PENDING':
    case 'WAITING':
      return 'pending_authorization';
    case 'DECLINED':
    case 'FAILED':
      return 'declined';
    case 'CANCELLED':
    case 'VOIDED':
      return 'cancelled';
    default:
      return 'failed';
  }
}

/** Derive next-action instructions from the wire shape. */
function mapNextAction(wire: CHOrderWireShape): NextAction {
  const redirect = wire.authorization_url ?? wire.authorizationUrl ?? wire.redirectUrl;
  if (redirect) {
    return { kind: 'redirect', redirectUrl: redirect };
  }
  if (wire.qrCode?.data) {
    return {
      kind: 'qr_code',
      qrCodeData: wire.qrCode.data,
      expiresAt: wire.qrCode.expiresAt,
    };
  }
  if (wire.voucher?.number) {
    return {
      kind: 'display_voucher',
      voucherNumber: wire.voucher.number,
      voucherUrl: wire.voucher.url,
    };
  }
  return { kind: 'none' };
}

/** Map CH error(s) to our canonical OrderError. */
function mapError(wire: CHOrderWireShape, apiTraceId?: string): OrderError {
  const first = wire.error?.[0];
  return {
    code: mapErrorCode(first?.code, first?.type),
    message: first?.message ?? 'Payment failed',
    providerCode: first?.code,
    apiTraceId,
  };
}

function mapErrorCode(code?: string, type?: string): OrderError['code'] {
  const key = (code ?? type ?? '').toUpperCase();
  if (key.includes('VALIDATION')) return 'VALIDATION_ERROR';
  if (key.includes('AUTH')) return 'AUTH_FAILED';
  if (key.includes('INSUFFICIENT')) return 'INSUFFICIENT_FUNDS';
  if (key.includes('RATE')) return 'RATE_LIMITED';
  if (key.includes('TIMEOUT')) return 'TIMEOUT';
  if (key.includes('NETWORK')) return 'NETWORK_ERROR';
  return 'PROVIDER_REJECTED';
}
