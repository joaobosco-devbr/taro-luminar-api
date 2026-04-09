const startedAt = Date.now();

const metrics = {
  requestsTotal: 0,
  requestsByRoute: {},
  responsesByStatus: {},
  requestDurationMs: {
    count: 0,
    total: 0,
    max: 0
  },
  payment: {
    createRequests: 0,
    createSuccess: 0,
    createErrors: 0,
    webhookReceived: 0,
    webhookApproved: 0,
    webhookRejected: 0,
    webhookIgnored: 0,
    webhookErrors: 0,
    webhookRetries: 0
  }
};

function incrementMap(map, key, amount = 1) {
  map[key] = (map[key] || 0) + amount;
}

function recordRequest(req, res, durationMs) {
  metrics.requestsTotal += 1;
  incrementMap(metrics.requestsByRoute, `${req.method} ${req.route?.path || req.path || req.originalUrl}`);
  incrementMap(metrics.responsesByStatus, String(res.statusCode));
  metrics.requestDurationMs.count += 1;
  metrics.requestDurationMs.total += durationMs;
  metrics.requestDurationMs.max = Math.max(metrics.requestDurationMs.max, durationMs);
}

function incrementPaymentMetric(metricName, amount = 1) {
  metrics.payment[metricName] = (metrics.payment[metricName] || 0) + amount;
}

function snapshot() {
  const averageDurationMs = metrics.requestDurationMs.count === 0
    ? 0
    : Number((metrics.requestDurationMs.total / metrics.requestDurationMs.count).toFixed(2));

  return {
    service: process.env.APP_NAME || 'taro-luminar-api',
    environment: process.env.NODE_ENV || 'development',
    uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
    requests: {
      total: metrics.requestsTotal,
      by_route: { ...metrics.requestsByRoute },
      by_status: { ...metrics.responsesByStatus },
      duration_ms: {
        count: metrics.requestDurationMs.count,
        average: averageDurationMs,
        max: metrics.requestDurationMs.max
      }
    },
    payment: {
      ...metrics.payment
    }
  };
}

function reset() {
  metrics.requestsTotal = 0;
  metrics.requestsByRoute = {};
  metrics.responsesByStatus = {};
  metrics.requestDurationMs = {
    count: 0,
    total: 0,
    max: 0
  };
  metrics.payment = {
    createRequests: 0,
    createSuccess: 0,
    createErrors: 0,
    webhookReceived: 0,
    webhookApproved: 0,
    webhookRejected: 0,
    webhookIgnored: 0,
    webhookErrors: 0,
    webhookRetries: 0
  };
}

module.exports = {
  recordRequest,
  incrementPaymentMetric,
  snapshot,
  reset
};
