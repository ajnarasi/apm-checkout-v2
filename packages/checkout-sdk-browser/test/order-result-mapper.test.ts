import { describe, expect, it } from 'vitest';
import { mapOrderResult } from '../src/core/order-result-mapper.js';

describe('mapOrderResult (ACL)', () => {
  it('maps AUTHORIZED → authorized', () => {
    const r = mapOrderResult({
      gatewayResponse: {
        transactionState: 'AUTHORIZED',
        transactionProcessingDetails: { orderId: 'O1', transactionId: 'T1' },
      },
    });
    expect(r.status).toBe('authorized');
    expect(r.orderId).toBe('O1');
    expect(r.transactionId).toBe('T1');
    expect(r.nextAction.kind).toBe('none');
  });

  it('maps PENDING + authorization_url → pending_authorization + redirect', () => {
    const r = mapOrderResult({
      gatewayResponse: {
        transactionState: 'PENDING',
        transactionProcessingDetails: { orderId: 'O2' },
      },
      authorization_url: 'https://bank.example.com/auth',
    });
    expect(r.status).toBe('pending_authorization');
    expect(r.nextAction).toEqual({ kind: 'redirect', redirectUrl: 'https://bank.example.com/auth' });
  });

  it('maps qrCode wire shape to qr_code next-action', () => {
    const r = mapOrderResult({
      gatewayResponse: {
        transactionState: 'PENDING',
        transactionProcessingDetails: { orderId: 'O3' },
      },
      qrCode: { data: '00020101', expiresAt: 1700000000000 },
    });
    expect(r.nextAction.kind).toBe('qr_code');
    if (r.nextAction.kind === 'qr_code') {
      expect(r.nextAction.qrCodeData).toBe('00020101');
      expect(r.nextAction.expiresAt).toBe(1700000000000);
    }
  });

  it('maps voucher wire shape to display_voucher', () => {
    const r = mapOrderResult({
      gatewayResponse: {
        transactionState: 'PENDING',
        transactionProcessingDetails: { orderId: 'O4' },
      },
      voucher: { number: '12345', url: 'https://example/voucher' },
    });
    expect(r.nextAction.kind).toBe('display_voucher');
  });

  it('maps DECLINED to declined with error', () => {
    const r = mapOrderResult({
      gatewayResponse: {
        transactionState: 'DECLINED',
        transactionProcessingDetails: { orderId: 'O5', apiTraceId: 'trace-1' },
      },
      error: [{ type: 'AUTH', code: 'BAD_KEY', message: 'invalid' }],
    });
    expect(r.status).toBe('declined');
    expect(r.error?.code).toBe('AUTH_FAILED');
    expect(r.error?.apiTraceId).toBe('trace-1');
  });

  it('unknown transactionState becomes failed (not silently success)', () => {
    const r = mapOrderResult({
      gatewayResponse: {
        transactionState: 'WIBBLE',
        transactionProcessingDetails: { orderId: 'O6' },
      },
    });
    expect(r.status).toBe('failed');
  });

  it('CANCELLED maps to cancelled', () => {
    const r = mapOrderResult({
      gatewayResponse: {
        transactionState: 'CANCELLED',
        transactionProcessingDetails: { orderId: 'O7' },
      },
    });
    expect(r.status).toBe('cancelled');
  });
});
