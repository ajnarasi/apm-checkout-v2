/**
 * SessionClient — browser-side wrapper around Commerce Hub's orders endpoint.
 *
 * Every adapter is given a SessionClient instance via AdapterContext.
 * Adapters call `authorizeOrder()` / `getOrder()` / `cancelOrder()` and
 * receive an `OrderResult` (the ACL domain type) — they NEVER see the
 * raw CH wire shape.
 *
 * The access token is the ONLY authentication material this client knows
 * about. It is passed as `Authorization: Bearer {accessToken}` on every
 * call. The merchant backend is responsible for session creation and for
 * returning a valid token.
 */

import type { OrderResult } from '@commercehub/shared-types';
import { mapOrderResult, type CHOrderWireShape } from './order-result-mapper.js';

export interface SessionClientConfig {
  accessToken: string;
  /** Base URL — usually the merchant backend's /v2/orders proxy. */
  baseUrl: string;
  /** Correlation id for log correlation across frontend + backend + CH. */
  correlationId?: string;
}

export interface AuthorizeOrderPayload {
  apm: string;
  merchantOrderId: string;
  amount: { value: number; currency: string };
  /** Provider-specific fields (e.g. Klarna authorization token). */
  providerData?: Record<string, unknown>;
  returnUrls?: { successUrl: string; cancelUrl: string };
  /**
   * v2.1: AUTHORIZE (auth-only) vs SALE (auth+capture in one shot).
   * Defaults to SALE for gateway-initiated, AUTHORIZE for merchant-initiated
   * (the SDK's BaseAdapter sets this based on `paymentInitiator`).
   */
  intent?: 'AUTHORIZE' | 'SALE';
}

/** v2.1: capture an existing auth via referenceTransactionId. */
export interface CaptureOrderPayload {
  /** CH-generated transactionId from the original auth's OrderResult. */
  referenceTransactionId: string;
  /** Optional partial-capture amount. Omit for full capture. */
  amount?: { value: number; currency: string };
}

/** v2.1: void an existing auth before settlement. */
export interface VoidOrderPayload {
  referenceTransactionId: string;
  reason?: string;
}

/** v2.1: refund a settled order. */
export interface RefundOrderPayload {
  referenceTransactionId: string;
  amount: { value: number; currency: string };
  reason?: string;
}

export class SessionClient {
  constructor(private readonly config: SessionClientConfig) {
    if (!config.accessToken) {
      throw new Error('SessionClient: accessToken is required');
    }
    if (!config.baseUrl) {
      throw new Error('SessionClient: baseUrl is required');
    }
  }

  /**
   * Create + authorize an order through the merchant backend's proxy.
   * Returns an OrderResult mapped from the CH wire shape via the ACL.
   */
  async authorizeOrder(payload: AuthorizeOrderPayload): Promise<OrderResult> {
    const wire = await this.request<CHOrderWireShape>(`/v2/orders/${payload.apm}`, 'POST', payload);
    return mapOrderResult(wire);
  }

  /** Fetch an existing order by id. Used by pending-state polling. */
  async getOrder(orderId: string): Promise<OrderResult> {
    const wire = await this.request<CHOrderWireShape>(
      `/v2/orders/${encodeURIComponent(orderId)}`,
      'GET'
    );
    return mapOrderResult(wire);
  }

  /** Cancel a pending order. */
  async cancelOrder(orderId: string): Promise<OrderResult> {
    const wire = await this.request<CHOrderWireShape>(
      `/v2/orders/${encodeURIComponent(orderId)}/cancel`,
      'POST'
    );
    return mapOrderResult(wire);
  }

  /**
   * v2.1: capture an existing auth.
   *
   * Forwards to the merchant backend's `POST /v2/orders/:orderId/capture`
   * route, which translates to a CH `/checkouts/v1/orders` call with
   * `transactionDetails.captureFlag=true` + `referenceTransactionDetails.referenceTransactionId`.
   *
   * Used by `CheckoutHandle.capture()` after a merchant-initiated authorize.
   */
  async captureOrder(orderId: string, payload: CaptureOrderPayload): Promise<OrderResult> {
    const wire = await this.request<CHOrderWireShape>(
      `/v2/orders/${encodeURIComponent(orderId)}/capture`,
      'POST',
      payload
    );
    return mapOrderResult(wire);
  }

  /**
   * v2.1: void an existing auth before settlement.
   *
   * Forwards to `POST /v2/orders/:orderId/void`, which sets CH
   * `transactionDetails.reversalReasonCode='VOID'` + `referenceTransactionId`.
   */
  async voidOrder(orderId: string, payload: VoidOrderPayload): Promise<OrderResult> {
    const wire = await this.request<CHOrderWireShape>(
      `/v2/orders/${encodeURIComponent(orderId)}/void`,
      'POST',
      payload
    );
    return mapOrderResult(wire);
  }

  /**
   * v2.1: refund a settled order.
   *
   * Forwards to `POST /v2/orders/:orderId/refund`, which sets CH
   * `order.intent='REFUND'` + `referenceTransactionId`.
   */
  async refundOrder(orderId: string, payload: RefundOrderPayload): Promise<OrderResult> {
    const wire = await this.request<CHOrderWireShape>(
      `/v2/orders/${encodeURIComponent(orderId)}/refund`,
      'POST',
      payload
    );
    return mapOrderResult(wire);
  }

  // -------- internals --------

  private async request<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
    const url = `${this.config.baseUrl.replace(/\/$/, '')}${path}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${this.config.accessToken}`,
    };
    if (this.config.correlationId) {
      headers['X-Correlation-Id'] = this.config.correlationId;
    }
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new SessionClientError('NETWORK_ERROR', `Fetch failed: ${message}`);
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (!response.ok) {
      throw new SessionClientError(
        mapHttpStatus(response.status),
        (data as { error?: string })?.error ?? `HTTP ${response.status}`,
        response.status
      );
    }

    return data as T;
  }
}

export type SessionClientErrorCode =
  | 'NETWORK_ERROR'
  | 'AUTH_FAILED'
  | 'VALIDATION_ERROR'
  | 'SERVER_ERROR'
  | 'NOT_FOUND'
  | 'UNKNOWN';

export class SessionClientError extends Error {
  constructor(
    public readonly code: SessionClientErrorCode,
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'SessionClientError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function mapHttpStatus(status: number): SessionClientErrorCode {
  if (status === 400) return 'VALIDATION_ERROR';
  if (status === 401 || status === 403) return 'AUTH_FAILED';
  if (status === 404) return 'NOT_FOUND';
  if (status >= 500) return 'SERVER_ERROR';
  return 'UNKNOWN';
}
