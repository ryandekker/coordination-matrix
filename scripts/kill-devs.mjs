#!/usr/bin/env node
/**
 * Kill all dev server processes on ports 3000-3099 and 3100-3199
 *
 * Usage:
 *   node scripts/kill-devs.mjs
 *   npm run kill-devs
 */

import { execSync } from 'child_process';

const FE_PORT_BASE = 3000;
const BE_PORT_BASE = 3100;
const PORT_RANGE = 100;

let killedCount = 0;

for (let offset = 0; offset < PORT_RANGE; offset++) {
  const fePort = FE_PORT_BASE + offset;
  const bePort = BE_PORT_BASE + offset;

  for (const port of [fePort, bePort]) {
    try {
      const result = execSync(`lsof -ti :${port}`, { encoding: 'utf-8' }).trim();
      if (result) {
        const pids = result.split('\n').filter(Boolean);
        for (const pid of pids) {
          try {
            execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
            console.log(`Killed process ${pid} on port ${port}`);
            killedCount++;
          } catch {
            // Process may have already exited
          }
        }
      }
    } catch {
      // No process on port
    }
  }
}

if (killedCount === 0) {
  console.log('No dev server processes found to kill.');
} else {
  console.log(`\nKilled ${killedCount} process(es).`);
}
