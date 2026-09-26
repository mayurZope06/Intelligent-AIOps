// Orchestrates and starts all 5 microservices as direct Node.js processes
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const SERVICES = [
  { name: 'gateway-service', port: 4000, dir: 'gateway-service' },
  { name: 'order-service', port: 4001, dir: 'order-service' },
  { name: 'payment-service', port: 4002, dir: 'payment-service' },
  { name: 'auth-service', port: 4003, dir: 'auth-service' },
  { name: 'inventory-service', port: 4004, dir: 'inventory-service' }
];

const children = [];

function checkPort(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/health`, (res) => {
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function startAll() {
  console.log('[Cluster Runner] Starting microservices cluster...');

  for (const svc of SERVICES) {
    const alreadyUp = await checkPort(svc.port);
    if (alreadyUp) {
      console.log(`[Cluster Runner] ${svc.name} is already UP on port ${svc.port}`);
      continue;
    }

    const scriptPath = path.join(__dirname, svc.dir, 'src', 'server.js');
    console.log(`[Cluster Runner] Spawning ${svc.name} on port ${svc.port}...`);

    const child = spawn(process.execPath, [scriptPath], {
      cwd: path.join(__dirname, svc.dir),
      env: {
        ...process.env,
        PORT: String(svc.port),
        GATEWAY_URL: 'http://localhost:4000',
        ORDER_SERVICE_URL: 'http://localhost:4001',
        PAYMENT_SERVICE_URL: 'http://localhost:4002',
        AUTH_SERVICE_URL: 'http://localhost:4003',
        INVENTORY_SERVICE_URL: 'http://localhost:4004'
      },
      stdio: ['ignore', 'inherit', 'inherit']
    });

    children.push({ name: svc.name, process: child });
  }

  // Poll until all services are UP
  console.log('[Cluster Runner] Waiting for all services to report /health UP...');
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const statuses = await Promise.all(SERVICES.map(s => checkPort(s.port)));
    if (statuses.every(Boolean)) {
      console.log('[Cluster Runner] ALL 5 MICROSERVICES ARE ONLINE AND HEALTHY!');
      return;
    }
  }

  console.warn('[Cluster Runner] Some services did not report ready in time.');
}

process.on('SIGINT', () => {
  console.log('[Cluster Runner] Terminating children...');
  children.forEach(c => c.process.kill());
  process.exit(0);
});

process.on('SIGTERM', () => {
  children.forEach(c => c.process.kill());
  process.exit(0);
});

startAll();
