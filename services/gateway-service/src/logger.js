// Structured JSON / Monospace logger for API Gateway

const formatLog = (level, event, meta = {}) => {
  const logObj = {
    timestamp: new Date().toISOString(),
    service: 'gateway-service',
    level: level.toUpperCase(),
    event,
    ...meta
  };
  return JSON.stringify(logObj);
};

const logger = {
  info: (event, meta) => {
    console.log(formatLog('info', event, meta));
  },
  warn: (event, meta) => {
    console.warn(formatLog('warn', event, meta));
  },
  error: (event, meta) => {
    console.error(formatLog('error', event, meta));
  }
};

module.exports = logger;
