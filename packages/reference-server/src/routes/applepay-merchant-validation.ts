/**
 * POST /v2/applepay/merchant-validation
 *
 * Apple Pay's `onvalidatemerchant` callback gives the browser a one-time
 * validation URL pointing at Apple's CDN. The merchant backend MUST sign a
 * request to that URL using its Apple Pay merchant certificate and return
 * the signed merchant session payload to the browser.
 *
 * This is the merchant-validation handoff that the architect Pass #2 review
 * called out as part of P0 #1 (provider-grouped base classes need real handoff
 * paths, not stubs).
 *
 * v2.1 implementation: stub. The real production route would:
 *   1. Load the Apple Pay merchant certificate + private key from secret store
 *   2. POST to the Apple validation URL with the merchant identity
 *   3. Return Apple's signed response to the browser unchanged
 *
 * For the POC we return a fake merchant session and document the upgrade path.
 * Production deployments must replace this with a real implementation before
 * Apple Pay can be used end-to-end.
 */

import type { Request, Response } from 'express';
import { logger } from '../observability/logger.js';

interface ValidationPayload {
  validationURL: string;
  domainName: string;
  displayName?: string;
}

export function buildApplePayMerchantValidation() {
  return async (req: Request, res: Response): Promise<void> => {
    const correlationId = res.locals.correlationId as string | undefined;
    const body = req.body as ValidationPayload;

    if (!body?.validationURL) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'validationURL is required',
        correlationId,
      });
      return;
    }

    // Production: validate validationURL is on an apple.com host before signing
    if (!/^https:\/\/[a-z0-9.-]+\.apple\.com\//i.test(body.validationURL)) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'validationURL must be on an apple.com host',
        correlationId,
      });
      return;
    }

    logger.info(
      {
        correlationId,
        validationURL: body.validationURL,
        domainName: body.domainName,
      },
      'applepay.merchant_validation.received'
    );

    // ────────────────────────────────────────────────────────────────────
    // PRODUCTION TODO (v2.2): replace this stub with a real merchant signing call.
    //
    // const merchantIdentity = await loadAppleMerchantCertificate();
    // const signedSession = await fetch(body.validationURL, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({
    //     merchantIdentifier: merchantIdentity.merchantId,
    //     displayName: body.displayName ?? 'Merchant Display Name',
    //     initiative: 'web',
    //     initiativeContext: body.domainName,
    //   }),
    //   // tls cert + key required
    //   agent: new https.Agent({
    //     cert: merchantIdentity.cert,
    //     key: merchantIdentity.key,
    //   }),
    // }).then((r) => r.json());
    // res.json(signedSession);
    // ────────────────────────────────────────────────────────────────────

    res.json({
      // Stub merchant session — Apple Pay will reject this in production.
      // Real Apple Pay sandbox returns a signed JSON blob with epochTimestamp,
      // expiresAt, merchantSessionIdentifier, nonce, merchantIdentifier,
      // domainName, displayName, signature.
      _stub: true,
      _message:
        'This is a STUB merchant session. Replace with real Apple merchant certificate signing before production. See applepay-merchant-validation.ts for the implementation site.',
      epochTimestamp: Date.now(),
      expiresAt: Date.now() + 60 * 1000,
      merchantSessionIdentifier: `STUB-${Date.now().toString(36)}`,
      nonce: 'stub-nonce',
      merchantIdentifier: 'merchant.com.example.stub',
      domainName: body.domainName,
      displayName: body.displayName ?? 'Stub Merchant',
      signature: 'STUB',
    });
  };
}
