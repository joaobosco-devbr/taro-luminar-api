const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.API_KEY = 'test-api-key';
process.env.MP_ACCESS_TOKEN_TEST = 'test-token';
process.env.DATABASE_FILE = path.join(os.tmpdir(), 'taro-luminar-tests', 'app.sqlite');
process.env.PAYMENT_WEBHOOK_MAX_RETRIES = '3';
process.env.PAYMENT_WEBHOOK_RETRY_DELAY_MS = '0';

const app = require('../src/app');
const { db } = require('../src/config/database');
const paymentService = require('../src/services/payment.service');
const userService = require('../src/services/user.service');
const logger = require('../src/utils/logger');
const metrics = require('../src/utils/metrics');

const databaseFile = process.env.DATABASE_FILE;

let server;
let baseUrl;
let originalCreatePayment;
let originalGetPaymentById;
let originalGetPaymentByIdWithRetry;
let originalApplyApprovedPaymentCredit;

function resetDatabase() {
  db.exec(`
    DELETE FROM credits_ledger;
    DELETE FROM payments;
    DELETE FROM users;
  `);
}

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const text = await response.text();
  let body = null;

  if (text) {
    const contentType = response.headers.get('content-type') || '';
    body = contentType.includes('application/json') ? JSON.parse(text) : text;
  }

  return { response, body };
}

function insertTrackedPayment({
  id,
  email,
  amount = paymentService.CREDIT_PRICE,
  status = 'pending',
  credited = 0,
  creditProcessing = 0
}) {
  const timestamp = new Date().toISOString();

  db.prepare(
    `INSERT INTO payments (
       id, email, amount, status, credited, credit_processing,
       processing_started_at, credited_at, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`
  ).run(
    String(id),
    email,
    amount,
    status,
    credited,
    creditProcessing,
    timestamp,
    timestamp
  );
}

function getLedgerRowsByPaymentId(paymentId) {
  return db.prepare(
    `SELECT payment_id, delta, reason
     FROM credits_ledger
     WHERE payment_id = ?
     ORDER BY id ASC`
  ).all(String(paymentId)).map(row => ({
    payment_id: row.payment_id,
    delta: row.delta,
    reason: row.reason
  }));
}

test.before(async () => {
  fs.mkdirSync(path.dirname(databaseFile), { recursive: true });
  resetDatabase();
  originalCreatePayment = paymentService.createPayment;
  originalGetPaymentById = paymentService.getPaymentById;
  originalGetPaymentByIdWithRetry = paymentService.getPaymentByIdWithRetry;
  originalApplyApprovedPaymentCredit = paymentService.applyApprovedPaymentCredit;

  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));

  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  await new Promise((resolve, reject) => {
    server.close(error => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  db.close();
  fs.rmSync(path.dirname(databaseFile), { recursive: true, force: true });
});

test.beforeEach(() => {
  resetDatabase();
  metrics.reset();
  paymentService.createPayment = originalCreatePayment;
  paymentService.getPaymentById = originalGetPaymentById;
  paymentService.getPaymentByIdWithRetry = originalGetPaymentByIdWithRetry;
  paymentService.applyApprovedPaymentCredit = originalApplyApprovedPaymentCredit;
});

test('GET /health responde sem API key', async () => {
  const { response, body } = await request('/health');

  assert.equal(response.status, 200);
  assert.deepEqual(body, { status: 'ok' });
  assert.ok(response.headers.get('x-request-id'));
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
});

test('POST /users/register exige API key', async () => {
  const { response, body } = await request('/users/register', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      name: 'Joao',
      email: 'joao@example.com'
    })
  });

  assert.equal(response.status, 401);
  assert.equal(body.error, 'Nao autorizado');
});

test('POST /users/register valida schema e rejeita e-mail invalido', async () => {
  const { response, body } = await request('/users/register', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.API_KEY
    },
    body: JSON.stringify({
      name: 'Joao',
      email: 'email-invalido'
    })
  });

  assert.equal(response.status, 400);
  assert.equal(body.error, 'Dados invalidos');
  assert.equal(body.details[0].path, 'email');
});

test('POST /users/register rejeita content-type diferente de application/json', async () => {
  const { response, body } = await request('/users/register', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.API_KEY,
      'content-type': 'text/plain'
    },
    body: '{"name":"Joao","email":"joao@example.com"}'
  });

  assert.equal(response.status, 415);
  assert.equal(body.error, 'Content-Type deve ser application/json');
});

test('POST /users/register rejeita JSON malformado', async () => {
  const { response, body } = await request('/users/register', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.API_KEY
    },
    body: '{"name":"Joao",'
  });

  assert.equal(response.status, 400);
  assert.equal(body.error, 'JSON invalido');
});

test('POST /users/register retorna 409 para e-mail duplicado', async () => {
  const headers = {
    'content-type': 'application/json',
    'x-api-key': process.env.API_KEY
  };

  const firstResponse = await request('/users/register', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'Joao',
      email: 'joao@example.com'
    })
  });

  const secondResponse = await request('/users/register', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'Joao Alterado',
      email: 'joao@example.com'
    })
  });

  assert.equal(firstResponse.response.status, 201);
  assert.equal(secondResponse.response.status, 409);
  assert.equal(secondResponse.body.error, 'Usuario ja cadastrado');
});

test('GET /users/:email retorna saldo do usuario', async () => {
  userService.registerUser({
    name: 'Joao',
    email: 'joao@example.com'
  });
  userService.addCredit('joao@example.com', 2, {
    reason: 'payment_credit'
  });

  const { response, body } = await request('/users/joao@example.com', {
    headers: {
      'x-api-key': process.env.API_KEY
    }
  });

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    name: 'Joao',
    email: 'joao@example.com',
    credits: 2
  });
});

test('POST /payment/webhook permanece publico', async () => {
  const { response } = await request('/payment/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      type: 'payment',
      data: {
        id: 'unknown-payment'
      }
    })
  });

  assert.equal(response.status, 200);
});

test('POST /payment/webhook valida schema e rejeita payload malformado', async () => {
  const { response, body } = await request('/payment/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      type: 'payment',
      data: {
        id: ''
      }
    })
  });

  assert.equal(response.status, 400);
  assert.equal(body.error, 'Dados invalidos');
});

test('POST /payment/create cria pagamento PIX e rastreia o pagamento para aprovacao posterior', async () => {
  paymentService.createPayment = async ({ email }) => {
    insertTrackedPayment({
      id: 'pix-payment-001',
      email,
      status: 'pending'
    });

    return {
      id: 'pix-payment-001',
      status: 'pending',
      point_of_interaction: {
        transaction_data: {
          qr_code: '000201PIX',
          qr_code_base64: 'base64-qr-code'
        }
      }
    };
  };

  const { response, body } = await request('/payment/create', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.API_KEY
    },
    body: JSON.stringify({
      email: 'joao@example.com'
    })
  });

  const trackedPayment = paymentService.getTrackedPaymentById('pix-payment-001');

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    id: 'pix-payment-001',
    status: 'pending',
    qr_code: '000201PIX',
    qr_code_base64: 'base64-qr-code'
  });
  assert.deepEqual(trackedPayment, {
    id: 'pix-payment-001',
    email: 'joao@example.com',
    amount: paymentService.CREDIT_PRICE,
    status: 'pending',
    credited: false,
    creditProcessing: false,
    webhookAttempts: 0,
    lastWebhookError: null,
    lastWebhookErrorAt: null,
    processingStartedAt: null,
    creditedAt: null,
    createdAt: trackedPayment.createdAt,
    updatedAt: trackedPayment.updatedAt
  });
});

test('logs de requisicao incluem request_id e a resposta devolve o mesmo header', async () => {
  const requestId = 'req-payment-create-001';
  const originalConsoleLog = console.log;
  const capturedLogs = [];

  paymentService.createPayment = async ({ email }) => ({
    id: 'pix-payment-log-001',
    status: 'pending',
    point_of_interaction: {
      transaction_data: {
        qr_code: '000201PIX',
        qr_code_base64: 'base64-qr-code'
      }
    }
  });

  console.log = message => {
    capturedLogs.push(message);
  };

  let response;

  try {
    ({ response } = await request('/payment/create', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.API_KEY,
        'x-request-id': requestId
      },
      body: JSON.stringify({
        email: 'joao@example.com'
      })
    }));
  } finally {
    console.log = originalConsoleLog;
  }

  const parsedLog = capturedLogs
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .find(entry => entry?.event === 'payment.create.response');

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-request-id'), requestId);
  assert.equal(parsedLog.request_id, requestId);
  assert.equal(parsedLog.level, 'info');
  assert.equal(parsedLog.event, 'payment.create.response');
  assert.equal(parsedLog.service, 'taro-luminar-api');
  assert.equal(parsedLog.environment, 'development');
  assert.equal(typeof parsedLog.pid, 'number');
  assert.equal(logger.getRequestId(), null);
});

test('GET /metrics exige API key e retorna metricas basicas da aplicacao', async () => {
  const unauthorizedResponse = await request('/metrics');

  assert.equal(unauthorizedResponse.response.status, 401);

  await request('/health');
  await request('/users/register', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.API_KEY
    },
    body: JSON.stringify({
      name: 'Joao',
      email: 'joao@example.com'
    })
  });

  const { response, body } = await request('/metrics', {
    headers: {
      'x-api-key': process.env.API_KEY
    }
  });

  assert.equal(response.status, 200);
  assert.equal(body.service, 'taro-luminar-api');
  assert.equal(body.environment, 'development');
  assert.ok(body.requests.total >= 3);
  assert.ok(body.requests.by_status['200'] >= 1);
  assert.ok(body.requests.by_status['201'] >= 1);
  assert.ok(body.requests.by_status['401'] >= 1);
  assert.ok(body.requests.by_route['GET /health'] >= 1);
  assert.ok(body.requests.by_route['POST /register'] >= 1);
  assert.equal(typeof body.requests.duration_ms.average, 'number');
  assert.equal(body.payment.createRequests, 0);
});

test('fluxo de pagamento aprovado adiciona 1 credito ao usuario e marca pagamento como creditado', async () => {
  userService.registerUser({
    name: 'Joao',
    email: 'joao@example.com'
  });

  paymentService.createPayment = async ({ email }) => {
    insertTrackedPayment({
      id: 'pix-payment-002',
      email,
      status: 'pending'
    });

    return {
      id: 'pix-payment-002',
      status: 'pending',
      point_of_interaction: {
        transaction_data: {
          qr_code: '000201PIX-APPROVED',
          qr_code_base64: 'base64-approved'
        }
      }
    };
  };

  paymentService.getPaymentById = async paymentId => ({
    id: paymentId,
    status: 'approved',
    transaction_amount: paymentService.CREDIT_PRICE,
    payer: {
      email: 'joao@example.com'
    }
  });

  const createResponse = await request('/payment/create', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.API_KEY
    },
    body: JSON.stringify({
      email: 'joao@example.com'
    })
  });

  const webhookResponse = await request('/payment/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      type: 'payment',
      data: {
        id: 'pix-payment-002'
      }
    })
  });

  const updatedUser = userService.getUserByEmail('joao@example.com');
  const trackedPayment = paymentService.getTrackedPaymentById('pix-payment-002');
  const ledgerRows = db.prepare(
    `SELECT payment_id, delta, reason
     FROM credits_ledger
     ORDER BY id ASC`
  ).all().map(row => ({
    payment_id: row.payment_id,
    delta: row.delta,
    reason: row.reason
  }));

  assert.equal(createResponse.response.status, 200);
  assert.equal(webhookResponse.response.status, 200);
  assert.equal(updatedUser.credits, 1);
  assert.equal(trackedPayment.status, 'approved');
  assert.equal(trackedPayment.credited, true);
  assert.equal(trackedPayment.creditProcessing, false);
  assert.equal(trackedPayment.webhookAttempts, 1);
  assert.equal(trackedPayment.lastWebhookError, null);
  assert.equal(ledgerRows.length, 1);
  assert.deepEqual(ledgerRows[0], {
    payment_id: 'pix-payment-002',
    delta: 1,
    reason: 'payment_credit'
  });
});

test('webhook aprovado e idempotente nao duplica credito para o mesmo pagamento', async () => {
  userService.registerUser({
    name: 'Joao',
    email: 'joao@example.com'
  });

  insertTrackedPayment({
    id: 'pix-payment-003',
    email: 'joao@example.com',
    status: 'pending'
  });

  paymentService.getPaymentById = async paymentId => ({
    id: paymentId,
    status: 'approved',
    transaction_amount: paymentService.CREDIT_PRICE,
    payer: {
      email: 'joao@example.com'
    }
  });

  const firstWebhook = await request('/payment/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      type: 'payment',
      data: {
        id: 'pix-payment-003'
      }
    })
  });

  const secondWebhook = await request('/payment/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      type: 'payment',
      data: {
        id: 'pix-payment-003'
      }
    })
  });

  const updatedUser = userService.getUserByEmail('joao@example.com');
  const trackedPayment = paymentService.getTrackedPaymentById('pix-payment-003');
  const ledgerRows = getLedgerRowsByPaymentId('pix-payment-003');

  assert.equal(firstWebhook.response.status, 200);
  assert.equal(secondWebhook.response.status, 200);
  assert.equal(updatedUser.credits, 1);
  assert.equal(trackedPayment.credited, true);
  assert.equal(trackedPayment.webhookAttempts, 1);
  assert.equal(ledgerRows.length, 1);
  assert.deepEqual(ledgerRows[0], {
    payment_id: 'pix-payment-003',
    delta: 1,
    reason: 'payment_credit'
  });
});

test('webhook rejeita pagamento aprovado com valor invalido sem adicionar credito', async () => {
  userService.registerUser({
    name: 'Joao',
    email: 'joao@example.com'
  });

  insertTrackedPayment({
    id: 'pix-payment-004',
    email: 'joao@example.com',
    status: 'pending'
  });

  paymentService.getPaymentById = async paymentId => ({
    id: paymentId,
    status: 'approved',
    transaction_amount: paymentService.CREDIT_PRICE + 5,
    payer: {
      email: 'joao@example.com'
    }
  });

  const webhookResponse = await request('/payment/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      type: 'payment',
      data: {
        id: 'pix-payment-004'
      }
    })
  });

  const updatedUser = userService.getUserByEmail('joao@example.com');
  const trackedPayment = paymentService.getTrackedPaymentById('pix-payment-004');
  const ledgerRows = getLedgerRowsByPaymentId('pix-payment-004');

  assert.equal(webhookResponse.response.status, 200);
  assert.equal(updatedUser.credits, 0);
  assert.equal(trackedPayment.status, 'approved');
  assert.equal(trackedPayment.credited, false);
  assert.equal(trackedPayment.creditProcessing, false);
  assert.equal(trackedPayment.webhookAttempts, 1);
  assert.equal(trackedPayment.lastWebhookError, 'Pagamento rejeitado por inconsistenca de dados');
  assert.deepEqual(ledgerRows, []);
});

test('webhook rejeita pagamento aprovado com e-mail divergente sem adicionar credito', async () => {
  userService.registerUser({
    name: 'Joao',
    email: 'joao@example.com'
  });

  insertTrackedPayment({
    id: 'pix-payment-005',
    email: 'joao@example.com',
    status: 'pending'
  });

  paymentService.getPaymentById = async paymentId => ({
    id: paymentId,
    status: 'approved',
    transaction_amount: paymentService.CREDIT_PRICE,
    payer: {
      email: 'fraude@example.com'
    }
  });

  const webhookResponse = await request('/payment/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      type: 'payment',
      data: {
        id: 'pix-payment-005'
      }
    })
  });

  const updatedUser = userService.getUserByEmail('joao@example.com');
  const trackedPayment = paymentService.getTrackedPaymentById('pix-payment-005');
  const ledgerRows = getLedgerRowsByPaymentId('pix-payment-005');

  assert.equal(webhookResponse.response.status, 200);
  assert.equal(updatedUser.credits, 0);
  assert.equal(trackedPayment.status, 'approved');
  assert.equal(trackedPayment.credited, false);
  assert.equal(trackedPayment.creditProcessing, false);
  assert.equal(trackedPayment.webhookAttempts, 1);
  assert.equal(trackedPayment.lastWebhookError, 'Pagamento rejeitado por inconsistenca de dados');
  assert.deepEqual(ledgerRows, []);
});

test('webhook rejeita tentativa de fraude com pagamento rastreado para outro e-mail e sem usuario alvo', async () => {
  insertTrackedPayment({
    id: 'pix-payment-006',
    email: 'joao@example.com',
    status: 'pending'
  });

  paymentService.getPaymentById = async paymentId => ({
    id: paymentId,
    status: 'approved',
    transaction_amount: paymentService.CREDIT_PRICE,
    payer: {
      email: 'atacante@example.com'
    }
  });

  const webhookResponse = await request('/payment/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      type: 'payment',
      data: {
        id: 'pix-payment-006'
      }
    })
  });

  const legitimateUser = userService.getUserByEmail('joao@example.com');
  const attackerUser = userService.getUserByEmail('atacante@example.com');
  const trackedPayment = paymentService.getTrackedPaymentById('pix-payment-006');
  const ledgerRows = getLedgerRowsByPaymentId('pix-payment-006');

  assert.equal(webhookResponse.response.status, 200);
  assert.equal(legitimateUser, null);
  assert.equal(attackerUser, null);
  assert.equal(trackedPayment.status, 'approved');
  assert.equal(trackedPayment.credited, false);
  assert.equal(trackedPayment.creditProcessing, false);
  assert.equal(trackedPayment.webhookAttempts, 1);
  assert.equal(trackedPayment.lastWebhookError, 'Pagamento rejeitado por inconsistenca de dados');
  assert.deepEqual(ledgerRows, []);
});

test('webhook faz retry ao consultar Mercado Pago e conclui o credito quando uma tentativa posterior funciona', async () => {
  userService.registerUser({
    name: 'Joao',
    email: 'joao@example.com'
  });

  insertTrackedPayment({
    id: 'pix-payment-007',
    email: 'joao@example.com',
    status: 'pending'
  });

  let mercadoPagoCalls = 0;
  paymentService.getPaymentById = async paymentId => {
    mercadoPagoCalls += 1;

    if (mercadoPagoCalls < 3) {
      throw new Error(`falha temporaria ${mercadoPagoCalls}`);
    }

    return {
      id: paymentId,
      status: 'approved',
      transaction_amount: paymentService.CREDIT_PRICE,
      payer: {
        email: 'joao@example.com'
      }
    };
  };

  const webhookResponse = await request('/payment/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      type: 'payment',
      data: {
        id: 'pix-payment-007'
      }
    })
  });

  const updatedUser = userService.getUserByEmail('joao@example.com');
  const trackedPayment = paymentService.getTrackedPaymentById('pix-payment-007');
  const ledgerRows = getLedgerRowsByPaymentId('pix-payment-007');

  assert.equal(webhookResponse.response.status, 200);
  assert.equal(mercadoPagoCalls, 3);
  assert.equal(updatedUser.credits, 1);
  assert.equal(trackedPayment.credited, true);
  assert.equal(trackedPayment.creditProcessing, false);
  assert.equal(trackedPayment.webhookAttempts, 1);
  assert.equal(trackedPayment.lastWebhookError, null);
  assert.equal(ledgerRows.length, 1);
});

test('webhook registra erro e libera o pagamento quando a consulta ao Mercado Pago falha apos todos os retries', async () => {
  userService.registerUser({
    name: 'Joao',
    email: 'joao@example.com'
  });

  insertTrackedPayment({
    id: 'pix-payment-008',
    email: 'joao@example.com',
    status: 'pending'
  });

  let mercadoPagoCalls = 0;
  paymentService.getPaymentById = async () => {
    mercadoPagoCalls += 1;
    throw new Error('mercado pago indisponivel');
  };

  const webhookResponse = await request('/payment/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      type: 'payment',
      data: {
        id: 'pix-payment-008'
      }
    })
  });

  const updatedUser = userService.getUserByEmail('joao@example.com');
  const trackedPayment = paymentService.getTrackedPaymentById('pix-payment-008');
  const ledgerRows = getLedgerRowsByPaymentId('pix-payment-008');

  assert.equal(webhookResponse.response.status, 500);
  assert.equal(mercadoPagoCalls, 3);
  assert.equal(updatedUser.credits, 0);
  assert.equal(trackedPayment.credited, false);
  assert.equal(trackedPayment.creditProcessing, false);
  assert.equal(trackedPayment.webhookAttempts, 1);
  assert.equal(trackedPayment.lastWebhookError, 'mercado pago indisponivel');
  assert.notEqual(trackedPayment.lastWebhookErrorAt, null);
  assert.deepEqual(ledgerRows, []);
});

test('webhook faz rollback do credito e libera o pagamento se ocorrer erro durante a gravacao do ledger', async () => {
  userService.registerUser({
    name: 'Joao',
    email: 'joao@example.com'
  });

  insertTrackedPayment({
    id: 'pix-payment-009',
    email: 'joao@example.com',
    status: 'pending'
  });

  paymentService.getPaymentById = async paymentId => ({
    id: paymentId,
    status: 'approved',
    transaction_amount: paymentService.CREDIT_PRICE,
    payer: {
      email: 'joao@example.com'
    }
  });

  const originalDbPrepare = db.prepare.bind(db);
  db.prepare = statement => {
    if (statement.includes('INSERT INTO credits_ledger')) {
      return {
        run() {
          throw new Error('falha ao gravar ledger');
        }
      };
    }

    return originalDbPrepare(statement);
  };

  let webhookResponse;

  try {
    webhookResponse = await request('/payment/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        type: 'payment',
        data: {
          id: 'pix-payment-009'
        }
      })
    });
  } finally {
    db.prepare = originalDbPrepare;
  }

  const updatedUser = userService.getUserByEmail('joao@example.com');
  const trackedPayment = paymentService.getTrackedPaymentById('pix-payment-009');
  const ledgerRows = getLedgerRowsByPaymentId('pix-payment-009');

  assert.equal(webhookResponse.response.status, 500);
  assert.equal(updatedUser.credits, 0);
  assert.equal(trackedPayment.status, 'approved');
  assert.equal(trackedPayment.credited, false);
  assert.equal(trackedPayment.creditProcessing, false);
  assert.equal(trackedPayment.webhookAttempts, 1);
  assert.equal(trackedPayment.lastWebhookError, 'falha ao gravar ledger');
  assert.notEqual(trackedPayment.lastWebhookErrorAt, null);
  assert.deepEqual(ledgerRows, []);
});

test('POST /tarot/sim-ou-nao consome credito e retorna resposta preenchida', async () => {
  userService.registerUser({
    name: 'Joao',
    email: 'joao@example.com'
  });
  userService.addCredit('joao@example.com');

  const { response, body } = await request('/tarot/sim-ou-nao', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.API_KEY
    },
    body: JSON.stringify({
      email: 'joao@example.com'
    })
  });

  const updatedUser = userService.getUserByEmail('joao@example.com');

  assert.equal(response.status, 200);
  assert.equal(typeof body.resposta, 'string');
  assert.ok(body.resposta.length > 0);
  assert.equal(updatedUser.credits, 0);
});

test('creditos ficam auditaveis no ledger', () => {
  userService.registerUser({
    name: 'Joao',
    email: 'joao@example.com'
  });

  userService.addCredit('joao@example.com', 2, {
    reason: 'payment_credit'
  });
  userService.consumeCredit('joao@example.com');

  const rows = db.prepare(
    `SELECT delta, reason
     FROM credits_ledger
     ORDER BY id ASC`
  ).all().map(row => ({
    delta: row.delta,
    reason: row.reason
  }));

  assert.deepEqual(rows, [
    { delta: 2, reason: 'payment_credit' },
    { delta: -1, reason: 'tarot_reading' }
  ]);
});
