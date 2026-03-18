import { test as setup } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const API_URL = process.env.API_URL || 'http://localhost:3100/api'
const AUTH_FILE = path.join(__dirname, '.auth', 'credentials.json')

setup('authenticate', async ({ request }) => {
  // Call the backend dev-login API directly
  const res = await request.post(`${API_URL}/auth/dev-login`, {
    data: { email: 'operator@example.com' },
  })

  if (!res.ok()) {
    throw new Error(`Dev login failed with status ${res.status()}: ${await res.text()}`)
  }

  const data = await res.json()

  // Save credentials to file for test fixtures to use
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true })
  fs.writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2))
})
