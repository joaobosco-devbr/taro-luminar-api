const { AsyncLocalStorage } = require('node:async_hooks');

const requestContext = new AsyncLocalStorage();

function serializeError(error) {
  if (!error) {
    return null;
  }

  return {
    message: error.message || String(error),
    name: error.name || 'Error'
  };
}

function write(level, event, context = {}) {
  const store = requestContext.getStore();
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    event,
    service: process.env.APP_NAME || 'taro-luminar-api',
    environment: process.env.NODE_ENV || 'development',
    pid: process.pid,
    ...(store?.requestId ? { request_id: store.requestId } : {}),
    ...context
  };

  const line = JSON.stringify(payload);

  if (level === 'error') {
    console.error(line);
    return;
  }

  if (level === 'warn') {
    console.warn(line);
    return;
  }

  console.log(line);
}

function info(event, context) {
  write('info', event, context);
}

function warn(event, context) {
  write('warn', event, context);
}

function error(event, context) {
  write('error', event, context);
}

function runWithRequestContext(requestId, callback) {
  return requestContext.run({ requestId }, callback);
}

function getRequestId() {
  return requestContext.getStore()?.requestId || null;
}

module.exports = {
  info,
  warn,
  error,
  serializeError,
  runWithRequestContext,
  getRequestId
};
