const lokiAdapter = require('../adapters/lokiAdapter');

const LOG_LEVELS = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40
};

const currentLevelStr = (process.env.LOG_LEVEL || 'DEBUG').toUpperCase();
const currentLevel = LOG_LEVELS[currentLevelStr] || LOG_LEVELS.DEBUG;

function formatTimestamp() {
  const d = new Date();
  return d.toISOString().replace('T', ' ').slice(0, 23);
}

class Logger {
  constructor(component = 'aiops-engine') {
    this.component = component;
  }

  log(level, message, meta = {}) {
    if ((LOG_LEVELS[level] || 20) < currentLevel) return;

    const time = formatTimestamp();
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    const formatted = `[${time}] [${level}] [${this.component}] ${message}${metaStr}`;

    if (level === 'ERROR') {
      console.error(formatted);
    } else if (level === 'WARN') {
      console.warn(formatted);
    } else {
      console.log(formatted);
    }

    // Push into telemetry log buffer so it appears in the frontend Telemetry log stream
    try {
      lokiAdapter.pushLog({
        service: 'aiops-engine',
        level,
        message: `[${this.component}] ${message}${metaStr}`,
        timestamp: new Date().toISOString(),
        meta
      });
    } catch {
      // silent
    }
  }

  debug(message, meta) {
    this.log('DEBUG', message, meta);
  }

  info(message, meta) {
    this.log('INFO', message, meta);
  }

  warn(message, meta) {
    this.log('WARN', message, meta);
  }

  error(message, meta) {
    this.log('ERROR', message, meta);
  }
}

module.exports = function getLogger(component) {
  return new Logger(component);
};
