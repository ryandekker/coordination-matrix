#!/usr/bin/env node
/**
 * Development server launcher with dynamic port allocation
 *
 * This script:
 * 1. Runs dev-ports.mjs to allocate ports and write .env.local files
 * 2. Starts the backend and frontend with the allocated ports
 *
 * Usage:
 *   node scripts/dev-start.mjs
 */

import { spawn, execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');

// Run port allocation
console.log('Allocating development ports...\n');

try {
  execSync('node scripts/dev-ports.mjs', {
    cwd: ROOT_DIR,
    stdio: ['inherit', 'pipe', 'inherit']
  });
} catch (err) {
  console.error('Failed to allocate ports');
  process.exit(1);
}

// Read the allocated ports from the .env.local files
const backendEnvPath = join(ROOT_DIR, 'backend', '.env.local');
const frontendEnvPath = join(ROOT_DIR, 'frontend', '.env.local');

if (!existsSync(backendEnvPath) || !existsSync(frontendEnvPath)) {
  console.error('Port allocation did not create .env.local files');
  process.exit(1);
}

const backendEnv = readFileSync(backendEnvPath, 'utf-8');
const frontendEnv = readFileSync(frontendEnvPath, 'utf-8');

const bePortMatch = backendEnv.match(/PORT=(\d+)/);
const feApiUrlMatch = frontendEnv.match(/NEXT_PUBLIC_API_URL=http:\/\/localhost:(\d+)/);

if (!bePortMatch) {
  console.error('Could not read backend port from .env.local');
  process.exit(1);
}

const bePort = parseInt(bePortMatch[1], 10);
// Frontend port is backend port - 100 (FE range starts at 3000, BE at 3100)
const fePort = bePort - 100;

console.log(`Starting development servers...`);
console.log(`  Frontend: http://localhost:${fePort}`);
console.log(`  Backend:  http://localhost:${bePort}/api\n`);

// Start MongoDB
try {
  execSync('npm run db:start', {
    cwd: ROOT_DIR,
    stdio: 'inherit'
  });
} catch (err) {
  // Ignore errors if already running
}

// Start backend and frontend concurrently
const concurrently = spawn('npx', [
  'concurrently',
  '-n', 'api,web',
  '-c', 'blue,green',
  `"cd backend && PORT=${bePort} CORS_ORIGIN=http://localhost:${fePort} npm run dev"`,
  `"cd frontend && PORT=${fePort} npm run dev"`
], {
  cwd: ROOT_DIR,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env }
});

concurrently.on('error', (err) => {
  console.error('Failed to start servers:', err);
  process.exit(1);
});

concurrently.on('exit', (code) => {
  process.exit(code || 0);
});

// Handle shutdown
process.on('SIGINT', () => {
  concurrently.kill('SIGINT');
});

process.on('SIGTERM', () => {
  concurrently.kill('SIGTERM');
});
