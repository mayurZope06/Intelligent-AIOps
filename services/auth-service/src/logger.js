// Structured JSON logger for Auth Service

const formatLog = (level, event, meta = {}) => {
  const logObj = {
    timestamp: new Date().toISOString(),
    service: 'auth-service',
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
