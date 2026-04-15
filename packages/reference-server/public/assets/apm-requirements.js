/**
 * v2.2 harness — Per-APM Requirements Catalog.
 *
 * For every APM in the v2.2 registry, declares:
 *   - clientParams     : what the browser SDK / merchant HTML must collect
 *   - serverParams     : what the merchant backend sends to CH /checkouts/v1/orders
 *   - webhookRequired  : does this APM settle async via webhook?
 *   - returnUrlRequired: does this APM need successUrl/cancelUrl?
 *   - amountTransform  : how amount is serialized on the CH wire
 *   - specialNotes     : per-APM gotchas
 *
 * Rendered in Docs mode as a 70-card filterable grid + detail drawer.
 *
 * Data-driven: the 70 entries are generated from a small per-pattern
 * template plus a per-APM override map. This keeps the file short and
 * the source-of-truth alignment with `apm-mapping.ts` explicit.
 */

// ─────────────────────────────────────────────────────────────────────
// Source list — mirrors APM_MAPPING from shared-types/apm-mapping.ts.
// Format: [id, displayName, pattern, chProvider?, chSourceType, chWalletType?, aggregator, currencies, countries]
// The renderer builds each entry at load time.
// ─────────────────────────────────────────────────────────────────────

const APMS = [
  // 39 PPRO-routed redirect/qr/voucher methods
  ['ideal',         'iDEAL',                  'redirect', 'IDEAL',         'AlternativePaymentMethod', null, 'PPRO', ['EUR'],              ['NL']],
  ['bancontact',    'Bancontact',             'redirect', 'BANCONTACT',    'AlternativePaymentMethod', null, 'PPRO', ['EUR'],              ['BE']],
  ['eps',           'EPS',                    'redirect', 'EPS',           'AlternativePaymentMethod', null, 'PPRO', ['EUR'],              ['AT']],
  ['blik',          'BLIK',                   'redirect', 'BLIK',          'AlternativePaymentMethod', null, 'PPRO', ['PLN'],              ['PL']],
  ['trustly',       'Trustly',                'redirect', 'TRUSTLY',       'AlternativePaymentMethod', null, 'PPRO', ['SEK','EUR'],        ['SE','FI','DK','EE','LV','LT']],
  ['wero',          'Wero',                   'redirect', 'WERO',          'AlternativePaymentMethod', null, 'PPRO', ['EUR'],              ['DE','FR','BE','NL','LU']],
  ['sofort',        'SOFORT',                 'redirect', 'SOFORT',        'AlternativePaymentMethod', null, 'PPRO', ['EUR'],              ['DE','AT','CH','BE','NL','IT','ES']],
  ['giropay',       'Giropay',                'redirect', 'GIROPAY',       'AlternativePaymentMethod', null, 'PPRO', ['EUR'],              ['DE']],
  ['przelewy24',    'Przelewy24',             'redirect', 'PRZELEWY24',    'AlternativePaymentMethod', null, 'PPRO', ['PLN','EUR'],        ['PL']],
  ['postfinance',   'PostFinance',            'redirect', 'POSTFINANCE',   'AlternativePaymentMethod', null, 'PPRO', ['CHF'],              ['CH']],
  ['mbway',         'MB WAY',                 'redirect', 'MBWAY',         'AlternativePaymentMethod', null, 'PPRO', ['EUR'],              ['PT']],
  ['multibanco',    'Multibanco',             'voucher',  'MULTIBANCO',    'AlternativePaymentMethod', null, 'PPRO', ['EUR'],              ['PT']],
  ['swish',         'Swish',                  'redirect', 'SWISH',         'AlternativePaymentMethod', null, 'PPRO', ['SEK'],              ['SE']],
  ['vipps',         'Vipps',                  'redirect', 'VIPPS',         'AlternativePaymentMethod', null, 'PPRO', ['NOK'],              ['NO']],
  ['mobilepay',     'MobilePay',              'redirect', 'MOBILEPAY',     'AlternativePaymentMethod', null, 'PPRO', ['DKK','EUR'],        ['DK','FI']],
  ['twint',         'TWINT',                  'redirect', 'TWINT',         'AlternativePaymentMethod', null, 'PPRO', ['CHF'],              ['CH']],
  ['spei',          'SPEI',                   'redirect', 'SPEI',          'AlternativePaymentMethod', null, 'PPRO', ['MXN'],              ['MX']],
  ['pse',           'PSE',                    'redirect', 'PSE',           'AlternativePaymentMethod', null, 'PPRO', ['COP'],              ['CO']],
  ['webpay',        'Webpay Plus',            'redirect', 'WEBPAY',        'AlternativePaymentMethod', null, 'PPRO', ['CLP'],              ['CL']],
  ['mercadopago',   'Mercado Pago',           'redirect', 'MERCADOPAGO',   'AlternativePaymentMethod', null, 'PPRO', ['ARS','BRL','MXN','COP','CLP','PEN','UYU'], ['AR','BR','MX','CO','CL','PE','UY']],
  ['pix',           'PIX',                    'qr',       'PIX',           'AlternativePaymentMethod', null, 'PPRO', ['BRL'],              ['BR']],
  ['boleto',        'Boleto',                 'voucher',  'BOLETO',        'AlternativePaymentMethod', null, 'PPRO', ['BRL'],              ['BR']],
  ['oxxo',          'OXXO',                   'voucher',  'OXXO',          'AlternativePaymentMethod', null, 'PPRO', ['MXN'],              ['MX']],
  ['efecty',        'Efecty',                 'voucher',  'EFECTY',        'AlternativePaymentMethod', null, 'PPRO', ['COP'],              ['CO']],
  ['rapipago',      'RapiPago',               'voucher',  'RAPIPAGO',      'AlternativePaymentMethod', null, 'PPRO', ['ARS'],              ['AR']],
  ['pagoefectivo',  'PagoEfectivo',           'voucher',  'PAGOEFECTIVO',  'AlternativePaymentMethod', null, 'PPRO', ['PEN'],              ['PE']],
  ['paynow',        'PayNow',                 'qr',       'PAYNOW',        'AlternativePaymentMethod', null, 'PPRO', ['SGD'],              ['SG']],
  ['gcash',         'GCash',                  'redirect', 'GCASH',         'AlternativePaymentMethod', null, 'PPRO', ['PHP'],              ['PH']],
  ['maya',          'Maya',                   'redirect', 'MAYA',          'AlternativePaymentMethod', null, 'PPRO', ['PHP'],              ['PH']],
  ['linepay',       'LINE Pay',               'redirect', 'LINEPAY',       'AlternativePaymentMethod', null, 'PPRO', ['JPY','TWD','THB'],  ['JP','TW','TH']],
  ['kakaopay',      'KakaoPay',               'redirect', 'KAKAOPAY',      'AlternativePaymentMethod', null, 'PPRO', ['KRW'],              ['KR']],
  ['dana',          'DANA',                   'qr',       'DANA',          'AlternativePaymentMethod', null, 'PPRO', ['IDR'],              ['ID']],
  ['ovo',           'OVO',                    'redirect', 'OVO',           'AlternativePaymentMethod', null, 'PPRO', ['IDR'],              ['ID']],
  ['shopeepay',     'ShopeePay',              'redirect', 'SHOPEEPAY',     'AlternativePaymentMethod', null, 'PPRO', ['IDR','PHP','THB','VND','MYR','SGD'], ['ID','PH','TH','VN','MY','SG']],
  ['touchngo',      "Touch 'n Go",            'redirect', 'TOUCHNGO',      'AlternativePaymentMethod', null, 'PPRO', ['MYR'],              ['MY']],
  ['alipay',        'Alipay',                 'qr',       'ALIPAY',        'AlternativePaymentMethod', null, 'PPRO', ['CNY'],              ['CN']],
  ['paypay',        'PayPay',                 'qr',       'PAYPAY',        'AlternativePaymentMethod', null, 'PPRO', ['JPY'],              ['JP']],
  ['upi',           'UPI',                    'qr',       'UPI',           'AlternativePaymentMethod', null, 'PPRO', ['INR'],              ['IN']],
  ['konbini',       'Konbini',                'voucher',  'KONBINI',       'AlternativePaymentMethod', null, 'PPRO', ['JPY'],              ['JP']],

  // 15 PPRO forward-compat extras
  ['mybank',        'MyBank',                 'redirect', 'MYBANK',        'AlternativePaymentMethod', null, 'PPRO', ['EUR'], ['IT']],
  ['finlandbanks',  'Finland Online Banking', 'redirect', 'FINLANDBANKS',  'AlternativePaymentMethod', null, 'PPRO', ['EUR'], ['FI']],
  ['baloto',        'Baloto',                 'voucher',  'BALOTO',        'AlternativePaymentMethod', null, 'PPRO', ['COP'], ['CO']],
  ['pagofacil',     'PagoFácil',              'voucher',  'PAGOFACIL',     'AlternativePaymentMethod', null, 'PPRO', ['ARS'], ['AR']],
  ['redpagos',      'RedPagos',               'voucher',  'REDPAGOS',      'AlternativePaymentMethod', null, 'PPRO', ['UYU'], ['UY']],
  ['sepa',          'SEPA Direct Debit',      'redirect', 'SEPA',          'AlternativePaymentMethod', null, 'PPRO', ['EUR'], ['DE','FR','IT','ES','NL','BE','AT','PT','IE','FI','LU']],
  ['becs',          'BECS Direct Debit',      'redirect', 'BECS',          'AlternativePaymentMethod', null, 'PPRO', ['AUD'], ['AU']],
  ['bacs',          'Bacs Direct Debit',      'redirect', 'BACS',          'AlternativePaymentMethod', null, 'PPRO', ['GBP'], ['GB']],
  ['paybybank',     'Pay by Bank',            'redirect', 'PAYBYBANK',     'AlternativePaymentMethod', null, 'PPRO', ['GBP'], ['GB']],
  ['ppro_wechatpay','WeChat Pay (via PPRO)',  'qr',       'PPRO_WECHATPAY','AlternativePaymentMethod', null, 'PPRO', ['CNY'], ['CN']],
  ['ppro_naverpay', 'NaverPay (via PPRO)',    'redirect', 'PPRO_NAVERPAY', 'AlternativePaymentMethod', null, 'PPRO', ['KRW'], ['KR']],
  ['ppro_gopay',    'GoPay (via PPRO)',       'qr',       'PPRO_GOPAY',    'AlternativePaymentMethod', null, 'PPRO', ['IDR'], ['ID']],
  ['ppro_truemoney','TrueMoney (via PPRO)',   'qr',       'PPRO_TRUEMONEY','AlternativePaymentMethod', null, 'PPRO', ['THB'], ['TH']],
  ['ppro_promptpay','PromptPay (via PPRO)',   'qr',       'PPRO_PROMPTPAY','AlternativePaymentMethod', null, 'PPRO', ['THB'], ['TH']],
  ['ppro_momo',     'MoMo (via PPRO)',        'qr',       'PPRO_MOMO',     'AlternativePaymentMethod', null, 'PPRO', ['VND'], ['VN']],

  // 16 direct integrations
  ['applepay',       'Apple Pay',              'native-wallet', null,     'DigitalWallet',            'APPLE_PAY',  'WALLET',  ['USD','EUR','GBP','CAD','AUD','JPY'], ['US','CA','GB','DE','FR','IT','ES','JP','AU']],
  ['googlepay',      'Google Pay',             'native-wallet', null,     'DigitalWallet',            'GOOGLE_PAY', 'WALLET',  ['USD','EUR','GBP','CAD','AUD','JPY','BRL','INR'], ['US','CA','GB','DE','FR','IT','ES','JP','AU','BR','IN']],
  ['paypal',         'PayPal',                 'button-sdk',    'PAYPAL', 'DigitalWallet',            'PAYPAL',     'PAYPAL',  ['USD','EUR','GBP','CAD','AUD','JPY'], ['US','CA','GB','DE','FR','IT','ES','JP','AU']],
  ['paypal_paylater','PayPal Pay Later',       'button-sdk',    'PAYPAL', 'DigitalWallet',            'PAYPAL',     'PAYPAL',  ['USD','EUR','GBP'], ['US','GB','DE','FR','IT','ES']],
  ['venmo',          'Venmo',                  'button-sdk',    'VENMO',  'DigitalWallet',            'VENMO',      'PAYPAL',  ['USD'], ['US']],
  ['cashapp',        'Cash App',               'button-sdk',    'CASHAPP','DigitalWallet',            'CASH_APP',   'CASHAPP', ['USD'], ['US']],
  ['klarna',         'Klarna',                 'tokenization',  'KLARNA', 'AlternativePaymentMethod', null,         'KLARNA',  ['USD','EUR','GBP','SEK','NOK','DKK'], ['US','GB','DE','AT','NL','SE','NO','DK','FI','BE','ES','IT','FR','PL','CH','AU']],
  ['affirm',         'Affirm',                 'tokenization',  'AFFIRM', 'AlternativePaymentMethod', null,         'AFFIRM',  ['USD','CAD'], ['US','CA']],
  ['afterpay',       'Afterpay',               'tokenization',  'AFTERPAY','AlternativePaymentMethod',null,         'AFTERPAY',['USD','CAD','AUD','NZD','GBP','EUR'], ['US','CA','AU','NZ','GB','FR','ES','IT']],
  ['sezzle',         'Sezzle',                 'tokenization',  'SEZZLE', 'AlternativePaymentMethod', null,         'OTHER',   ['USD','CAD'], ['US','CA']],
  ['zip',            'Zip',                    'tokenization',  'ZIP',    'AlternativePaymentMethod', null,         'OTHER',   ['USD','AUD','NZD'], ['US','AU','NZ']],
  ['alipayplus',     'Alipay+',                'qr',            'ALIPAYPLUS','AlternativePaymentMethod',null,       'OTHER',   ['CNY','HKD','KRW','THB','MYR','IDR','PHP','VND','SGD','JPY','USD','EUR'], ['CN','HK','KR','TH','MY','ID','PH','VN','SG','JP']],
  ['wechatpay',      'WeChat Pay',             'qr',            'WECHATPAY','AlternativePaymentMethod',null,        'OTHER',   ['CNY'], ['CN','HK']],
  ['grabpay',        'GrabPay',                'redirect',      'GRABPAY','AlternativePaymentMethod', null,         'OTHER',   ['SGD','MYR','PHP','THB','VND','IDR'], ['SG','MY','PH','TH','VN','ID']],
  ['zepto',          'Zepto (PayTo)',          'redirect',      'ZEPTO',  'AlternativePaymentMethod', null,         'ZEPTO',   ['AUD'], ['AU']],
  ['tabapay',        'TabaPay',                'button-sdk',    'TABAPAY','AlternativePaymentMethod', null,         'TABAPAY', ['USD'], ['US']],
];

// ─────────────────────────────────────────────────────────────────────
// Pattern → client-param template
// ─────────────────────────────────────────────────────────────────────

const PATTERN_CLIENT_PARAMS = {
  redirect: [
    { name: 'amount',          type: '{ value: number, currency: string }', required: true,  example: "{ value: 49.99, currency: 'EUR' }", description: 'Decimal amount + ISO 4217 currency' },
    { name: 'merchantOrderId', type: 'string',                                required: true,  example: 'ord_01HV5',                         description: 'Merchant unique order reference' },
    { name: 'returnUrls',      type: '{ successUrl, cancelUrl }',             required: true,  example: "{ successUrl: 'https://shop/return', cancelUrl: 'https://shop/cancel' }", description: 'Where to send the user after the bank/redirect flow' },
    { name: 'customer',        type: '{ firstName, lastName, email }',        required: false, example: '{ firstName: "Jane", lastName: "Doe" }', description: 'Some redirect APMs require customer context (SEPA, iDEAL)' },
  ],
  tokenization: [
    { name: 'amount',          type: '{ value, currency }',                   required: true,  example: "{ value: 129.00, currency: 'USD' }", description: 'BNPL providers use this for risk scoring' },
    { name: 'merchantOrderId', type: 'string',                                required: true,  example: 'ord_01HV5',                         description: 'Merchant reference' },
    { name: 'items',           type: 'Array<LineItem>',                       required: true,  example: '[{ name, quantity, unitPrice }]',  description: 'BNPL widgets need line items' },
    { name: 'shippingAddress', type: 'Address',                               required: true,  example: "{ country: 'US', postalCode: '94107' }", description: 'BNPL risk engine needs address at session mint time' },
    { name: 'billingAddress',  type: 'Address',                               required: false, example: '{ ... }',                           description: 'Required by some Klarna markets' },
  ],
  'native-wallet': [
    { name: 'amount',          type: '{ value, currency }',                   required: true,  example: "{ value: 19.99, currency: 'USD' }", description: 'Total to charge' },
    { name: 'countryCode',     type: 'string',                                required: true,  example: 'US',                                description: 'ISO 3166-1 alpha-2' },
    { name: 'merchantId',      type: 'string',                                required: true,  example: 'merchant.com.example',              description: 'Apple Pay: your Apple merchant id. Google Pay: gatewayMerchantId' },
    { name: 'supportedNetworks', type: 'string[]',                            required: true,  example: "['visa', 'masterCard', 'amex']",    description: 'Card networks allowed in the wallet sheet' },
  ],
  'button-sdk': [
    { name: 'amount',          type: '{ value, currency }',                   required: true,  example: "{ value: 74.50, currency: 'USD' }", description: 'Total' },
    { name: 'merchantOrderId', type: 'string',                                required: true,  example: 'ord_01HV5',                         description: 'Merchant reference' },
    { name: 'clientId',        type: 'string',                                required: true,  example: 'AXj...',                            description: 'Provider sandbox client-id (PayPal / Venmo / Cash App)' },
    { name: 'returnUrls',      type: '{ successUrl, cancelUrl }',             required: false, example: '{ ... }',                           description: 'Required for redirect-fallback flows' },
  ],
  qr: [
    { name: 'amount',          type: '{ value, currency }',                   required: true,  example: "{ value: 150.00, currency: 'BRL' }", description: 'QR APMs encode this in the QR payload' },
    { name: 'merchantOrderId', type: 'string',                                required: true,  example: 'ord_01HV5',                         description: 'Merchant reference' },
    { name: 'country',         type: 'string',                                required: true,  example: 'BR',                                description: 'ISO country — determines which QR scheme to use' },
  ],
  voucher: [
    { name: 'amount',          type: '{ value, currency }',                   required: true,  example: "{ value: 100.00, currency: 'BRL' }", description: 'Voucher face value' },
    { name: 'merchantOrderId', type: 'string',                                required: true,  example: 'ord_01HV5',                         description: 'Merchant reference' },
    { name: 'country',         type: 'string',                                required: true,  example: 'BR',                                description: 'ISO country — determines voucher format (Boleto, OXXO, Konbini)' },
    { name: 'customer.taxId',  type: 'string',                                required: true,  example: '123.456.789-00',                    description: 'Brazil CPF or Mexico RFC required for tax receipt' },
  ],
};

// ─────────────────────────────────────────────────────────────────────
// Universal server-side params (same shape for every APM — the whole
// point of ADR-004 is that every APM hits the same endpoint).
// ─────────────────────────────────────────────────────────────────────

function buildServerParams(apm) {
  const base = [
    { name: 'Authorization',                 type: 'header',  required: true,  example: 'Bearer {accessToken}',         description: 'From CH Credentials API /payments-vas/v1/security/credentials' },
    { name: 'Api-Key',                       type: 'header',  required: true,  example: 'xxxxxxxxxxxx',                 description: 'Your Fiserv API key from the merchant portal' },
    { name: 'Client-Request-Id',             type: 'header',  required: true,  example: '<UUID>',                       description: 'Unique per-request UUID for idempotency' },
    { name: 'paymentSource.sourceType',      type: 'body',    required: true,  example: `'${apm.chSourceType}'`,        description: 'Fixed value per APM family — determines how CH parses the source' },
    ...(apm.chWalletType ? [{ name: 'paymentSource.walletType', type: 'body', required: true, example: `'${apm.chWalletType}'`, description: 'Wallet network for native wallets / PayPal family' }] : []),
    ...(apm.chProvider ? [{ name: 'paymentMethod.provider', type: 'body', required: true, example: `'${apm.chProvider}'`, description: 'UPPERCASE adapter id. CH routes on this. For PPRO methods this is the sub-method (IDEAL, WERO, SOFORT...) — the string "PPRO" NEVER appears on the wire.' }] : []),
    { name: 'transactionDetails.captureFlag', type: 'body',    required: true,  example: 'true',                         description: 'true = sale (auth+capture), false = authorize-only (merchant initiator)' },
    { name: 'checkoutInteractions.paymentInitiator', type: 'body', required: true, example: "'GATEWAY' | 'MERCHANT'",    description: 'GATEWAY = auto-capture, MERCHANT = pause in awaiting_merchant_capture' },
    { name: 'amount.total',                   type: 'body',    required: true,  example: apm.amountTransform === 'MULTIPLY_100' ? '4999' : '49.99', description: `Applied amount transform: ${apm.amountTransform}` },
    { name: 'amount.currency',                type: 'body',    required: true,  example: `'${apm.currencies[0] ?? 'USD'}'`, description: 'ISO 4217 currency code' },
    { name: 'merchantOrderId',                type: 'body',    required: true,  example: "'ord_01HV5'",                  description: 'Merchant reference (passed through from /v2/sessions)' },
  ];
  if (apm.returnUrlRequired) {
    base.push({ name: 'checkoutInteractions.returnUrls', type: 'body', required: true, example: '{ successUrl, cancelUrl }', description: 'Both URLs required for the redirect handoff' });
  }
  return base;
}

// ─────────────────────────────────────────────────────────────────────
// Per-APM overrides (amount transform, callbacks, tokenTTL, notes)
// ─────────────────────────────────────────────────────────────────────

const OVERRIDES = {
  klarna:         { amountTransform: 'MULTIPLY_100', tokenTTLMs: 60 * 60 * 1000, notes: ['Client token from /payments/v1/sessions expires in ~48h', 'Billing country fixed at session mint time', 'OnsiteMessaging data-key is separate from payments client token'] },
  affirm:         { amountTransform: 'MULTIPLY_100', notes: ['BNPL promo widget requires a separate public-key config', 'US / CA only'] },
  afterpay:       { amountTransform: 'NUMBER_TO_STRING', notes: ['Partial refund supported but only within 120 days', 'Brand rebranding to Clearpay in UK/EU'] },
  sezzle:         { amountTransform: 'MULTIPLY_100', notes: ['Requires a minimum order amount per market', 'Only supports USD and CAD'] },
  zip:            { amountTransform: 'MULTIPLY_100', notes: ['Formerly Quadpay in US', 'Requires AU merchant pairing for Australian shoppers'] },
  applepay:       { amountTransform: 'PASSTHROUGH', tokenTTLMs: 60 * 1000, notes: ['Requires domain verification file at .well-known/apple-developer-merchantid-domain-association', 'Safari-only for native sheet; Chrome gets a web fallback', 'Token is single-use and seconds-scale TTL — do not retry a consumed token'] },
  googlepay:      { amountTransform: 'PASSTHROUGH', notes: ['gatewayMerchantId is your Fiserv merchant id, not your Google merchant id', 'Use environment="TEST" for sandbox', 'Sandbox TEST tokens always decrypt as test data'] },
  paypal:         { amountTransform: 'PASSTHROUGH', notes: ['PayPal SDK currency is fixed at script-load time — changing currency mid-session requires a full reload', 'onShippingAddressChange + onShippingOptionsChange are the only interactive callbacks', 'Auth window is 29 days'] },
  paypal_paylater:{ amountTransform: 'PASSTHROUGH', notes: ['Shares the PayPal SDK with enable-funding=paylater', 'Not available outside US / UK / DE / FR / IT / ES'] },
  venmo:          { amountTransform: 'PASSTHROUGH', notes: ['Shares PayPal SDK but does NOT expose shipping callbacks', 'US-only', 'Requires Venmo enabled on your sandbox PayPal app'] },
  cashapp:        { amountTransform: 'MULTIPLY_100', notes: ['Sandbox CDN is at sandbox.kit.cash.app, not kit.cash.app', 'Grant ids expire in 15 minutes', 'US-only'] },
  alipayplus:     { amountTransform: 'DECIMAL_TO_STRING_CENTS', notes: ['Single adapter covers Alipay, Kakao Pay, DANA, TrueMoney and more via Alipay+ routing', 'Currency per market — do not hardcode CNY'] },
  wechatpay:      { amountTransform: 'MULTIPLY_100', notes: ['Requires WeChat-registered merchant (not all Fiserv merchants have this)', 'QR expires in 2 hours'] },
  grabpay:        { amountTransform: 'MULTIPLY_100', notes: ['APAC only', 'Return URL required'] },
  zepto:          { amountTransform: 'MULTIPLY_100', notes: ['PayTo rail (Australia NPP)', 'OAuth bootstrap required before first use', 'merchantOrderId max 35 chars'] },
  tabapay:        { amountTransform: 'PASSTHROUGH', notes: ['Card-rail alternative for push-to-debit', 'US-only'] },
  pix:            { amountTransform: 'MULTIPLY_100', notes: ['PIX QRs are single-use and expire in 15-30 min', 'Merchant profile may require payer CPF', 'Webhooks can lag 30-120 seconds'] },
  boleto:         { amountTransform: 'MULTIPLY_100', notes: ['Payer has up to 3 days to pay at a bank', 'CPF required on order', 'Webhook arrives on settlement day'] },
  oxxo:           { amountTransform: 'MULTIPLY_100', notes: ['Payer prints a voucher and pays at an OXXO store', 'Up to 3-day settlement delay'] },
  konbini:        { amountTransform: 'MULTIPLY_100', notes: ['Payer pays at a Japanese convenience store (Lawson, FamilyMart)', 'Up to 3-day settlement delay'] },
  ideal:          { amountTransform: 'MULTIPLY_100', notes: ['EUR only, NL only', 'Does NOT work inside an iframe — always redirect top window', 'Returns bank list BICs which drift over time — refresh quarterly'] },
};

// ─────────────────────────────────────────────────────────────────────
// Build the full catalog
// ─────────────────────────────────────────────────────────────────────

function buildEntry(row) {
  const [id, displayName, pattern, chProvider, chSourceType, chWalletType, aggregator, currencies, countries] = row;
  const override = OVERRIDES[id] ?? {};
  const isPpro = aggregator === 'PPRO';

  const webhookRequired = pattern === 'redirect' || pattern === 'qr' || pattern === 'voucher';
  const returnUrlRequired = pattern === 'redirect' || pattern === 'button-sdk';
  const amountTransform = override.amountTransform ?? 'MULTIPLY_100';
  const routingChain = isPpro
    ? `CH → PPRO → ${chProvider}`
    : chWalletType ? `CH → wallet ${chWalletType}` : `CH → ${chProvider ?? id.toUpperCase()}`;

  const notes = [...(override.notes ?? [])];
  if (isPpro) {
    notes.push('PPRO-routed: CH internally translates paymentMethod.provider to PPRO /v1/payment-charges. The literal string "PPRO" NEVER appears in the merchant-to-CH wire.');
  }

  const apmMeta = { id, displayName, pattern, chProvider, chSourceType, chWalletType, aggregator, currencies, countries, amountTransform, webhookRequired, returnUrlRequired };

  return {
    apm: id,
    displayName,
    pattern,
    aggregator,
    routingChain,
    chSourceType,
    chWalletType: chWalletType ?? null,
    chProvider: chProvider ?? null,
    currencies,
    countries,
    amountTransform,
    webhookRequired,
    returnUrlRequired,
    tokenTTLMs: override.tokenTTLMs ?? null,
    clientParams: PATTERN_CLIENT_PARAMS[pattern] ?? [],
    serverParams: buildServerParams(apmMeta),
    specialNotes: notes,
  };
}

export const APM_REQUIREMENTS = APMS.map(buildEntry);

export const REQUIREMENTS_STATS = {
  total: APM_REQUIREMENTS.length,
  ppro: APM_REQUIREMENTS.filter((r) => r.aggregator === 'PPRO').length,
  direct: APM_REQUIREMENTS.filter((r) => r.aggregator !== 'PPRO').length,
  byPattern: APM_REQUIREMENTS.reduce((acc, r) => {
    acc[r.pattern] = (acc[r.pattern] ?? 0) + 1;
    return acc;
  }, {}),
};

export function getApmRequirements(id) {
  return APM_REQUIREMENTS.find((r) => r.apm === id);
}

export function filterApmRequirements({ pattern, currency, country, webhook, returnUrl, ppro } = {}) {
  return APM_REQUIREMENTS.filter((r) => {
    if (pattern && r.pattern !== pattern) return false;
    if (currency && !r.currencies.includes(currency)) return false;
    if (country && !r.countries.includes(country)) return false;
    if (webhook === true && !r.webhookRequired) return false;
    if (webhook === false && r.webhookRequired) return false;
    if (returnUrl === true && !r.returnUrlRequired) return false;
    if (ppro === true && r.aggregator !== 'PPRO') return false;
    if (ppro === false && r.aggregator === 'PPRO') return false;
    return true;
  });
}

export const PATTERN_COLORS = {
  redirect:       'oklch(80% 0.180 72)',
  tokenization:   'oklch(71% 0.208 48)',
  'native-wallet':'oklch(68% 0.180 300)',
  'button-sdk':   'oklch(72% 0.140 200)',
  qr:             'oklch(70% 0.200 10)',
  voucher:        'oklch(60% 0.020 260)',
};
