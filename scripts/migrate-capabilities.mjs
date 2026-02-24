#!/usr/bin/env node
/**
 * Migration script for capability documents
 *
 * Reads capability definitions from docs/capabilities/*.md (source of truth)
 * and upserts them into the production database via the API.
 *
 * Each .md file uses YAML frontmatter for metadata:
 *   capabilityId, title, complexity, tags, summary
 *
 * The markdown body (after frontmatter) becomes the document content.
 *
 * Usage:
 *   node scripts/migrate-capabilities.mjs --api-url https://cm.hcizero.com/api --api-key cm_ak_xxx
 *   node scripts/migrate-capabilities.mjs --config scripts/daemon-jobs.yaml
 *   node scripts/migrate-capabilities.mjs --dry-run
 *
 * Options:
 *   --api-url    API base URL (default: http://localhost:3100/api)
 *   --api-key    API key for authentication
 *   --config     Load apiUrl and apiKey from daemon config YAML
 *   --dry-run    Show what would be done without making changes
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { parse as parseYaml } from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CAPABILITIES_DIR = resolve(__dirname, '..', 'docs', 'capabilities');
const INDEX_FILE = join(CAPABILITIES_DIR, '_index.yaml');

// ============================================================================
// Capability File Parser
// ============================================================================

/**
 * Parse a capability markdown file with YAML frontmatter.
 * Returns { capabilityId, title, complexity, tags, summary, content }
 */
function parseCapabilityFile(filePath) {
  const raw = readFileSync(filePath, 'utf-8');

  // Extract YAML frontmatter between --- delimiters
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) {
    throw new Error(`No YAML frontmatter found in ${filePath}`);
  }

  const frontmatter = parseYaml(fmMatch[1]);
  const content = fmMatch[2].trim();

  // Validate required fields
  const required = ['capabilityId', 'title', 'complexity', 'summary'];
  for (const field of required) {
    if (!frontmatter[field]) {
      throw new Error(`Missing required frontmatter field '${field}' in ${filePath}`);
    }
  }

  return {
    capabilityId: frontmatter.capabilityId,
    title: frontmatter.title,
    capabilityComplexity: frontmatter.complexity,
    type: 'capability',
    status: 'approved',
    tags: frontmatter.tags || [],
    summary: frontmatter.summary,
    source: frontmatter.source || null,
    content,
  };
}

/**
 * Load all capabilities from the docs/capabilities/ directory.
 * Reads _index.yaml for the file list, or falls back to scanning .md files.
 */
function loadCapabilities() {
  const capabilities = [];

  if (existsSync(INDEX_FILE)) {
    const indexRaw = readFileSync(INDEX_FILE, 'utf-8');
    const index = parseYaml(indexRaw);

    if (!index?.capabilities?.length) {
      console.warn('Warning: _index.yaml exists but has no capabilities listed');
      return capabilities;
    }

    for (const entry of index.capabilities) {
      const filePath = join(CAPABILITIES_DIR, entry.file);
      if (!existsSync(filePath)) {
        console.error(`Warning: Listed file not found: ${entry.file}`);
        continue;
      }
      try {
        capabilities.push(parseCapabilityFile(filePath));
      } catch (err) {
        console.error(`Error parsing ${entry.file}: ${err.message}`);
      }
    }
  } else {
    console.error('Error: _index.yaml not found at', INDEX_FILE);
    process.exit(1);
  }

  return capabilities;
}

// ============================================================================
// CLI Argument Parsing
// ============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    apiUrl: 'http://localhost:3100/api',
    apiKey: null,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--api-url':
        config.apiUrl = args[++i];
        break;
      case '--api-key':
        config.apiKey = args[++i];
        break;
      case '--config': {
        const configPath = args[++i];
        try {
          const yamlContent = readFileSync(configPath, 'utf-8');
          const yamlConfig = parseYaml(yamlContent);
          if (yamlConfig.defaults?.apiUrl) config.apiUrl = yamlConfig.defaults.apiUrl;
          if (yamlConfig.defaults?.apiKey) config.apiKey = yamlConfig.defaults.apiKey;
        } catch (err) {
          console.error(`Failed to load config from ${configPath}:`, err.message);
          process.exit(1);
        }
        break;
      }
      case '--dry-run':
        config.dryRun = true;
        break;
      case '--help':
        console.log(`
Usage: node scripts/migrate-capabilities.mjs [options]

Reads capability documents from docs/capabilities/*.md and upserts them
into the production database via the API.

Options:
  --api-url <url>     API base URL (default: http://localhost:3100/api)
  --api-key <key>     API key for authentication
  --config <path>     Load apiUrl and apiKey from daemon config YAML
  --dry-run           Show what would be done without making changes
  --help              Show this help message

Source files:
  docs/capabilities/_index.yaml   - File manifest
  docs/capabilities/*.md          - Capability documents (YAML frontmatter + markdown)
`);
        process.exit(0);
    }
  }

  // Check for API key in environment
  if (!config.apiKey && process.env.MATRIX_API_KEY) {
    config.apiKey = process.env.MATRIX_API_KEY;
  }

  return config;
}

// ============================================================================
// API Helpers
// ============================================================================

function getHeaders(config) {
  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) {
    headers['X-API-Key'] = config.apiKey;
  }
  return headers;
}

async function findCapabilityByIdField(config, capabilityId) {
  const url = `${config.apiUrl}/documents?type=capability&limit=100`;
  const response = await fetch(url, { headers: getHeaders(config) });
  if (!response.ok) {
    throw new Error(`Failed to fetch documents: ${response.status}`);
  }
  const result = await response.json();
  return result.data?.find(doc => doc.capabilityId === capabilityId);
}

async function createDocument(config, doc) {
  const response = await fetch(`${config.apiUrl}/documents`, {
    method: 'POST',
    headers: getHeaders(config),
    body: JSON.stringify(doc),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create document: ${response.status} - ${error}`);
  }
  return response.json();
}

async function updateDocument(config, docId, changes) {
  const response = await fetch(`${config.apiUrl}/documents/${docId}`, {
    method: 'PATCH',
    headers: getHeaders(config),
    body: JSON.stringify(changes),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to update document: ${response.status} - ${error}`);
  }
  return response.json();
}

// ============================================================================
// Migration Logic
// ============================================================================

async function migrateCapabilities(config) {
  console.log('\n=== Capability Documents Migration ===\n');
  console.log(`Source:  ${CAPABILITIES_DIR}`);
  console.log(`API URL: ${config.apiUrl}`);
  console.log(`Dry Run: ${config.dryRun}\n`);

  // Load capabilities from codebase files
  const capabilities = loadCapabilities();
  console.log(`Found ${capabilities.length} capability file(s)\n`);

  if (capabilities.length === 0) {
    console.log('No capabilities to migrate.');
    return { created: 0, updated: 0, unchanged: 0, errors: [] };
  }

  const results = { created: 0, updated: 0, unchanged: 0, errors: [] };

  for (const cap of capabilities) {
    console.log(`Processing: ${cap.capabilityId} (complexity ${cap.capabilityComplexity})`);

    try {
      // Check if capability already exists
      const existing = await findCapabilityByIdField(config, cap.capabilityId);

      if (existing) {
        // Check if content has changed
        const contentChanged = existing.content !== cap.content;
        const summaryChanged = existing.summary !== cap.summary;
        const complexityChanged = existing.capabilityComplexity !== cap.capabilityComplexity;
        const titleChanged = existing.title !== cap.title;

        if (contentChanged || summaryChanged || complexityChanged || titleChanged) {
          const changes = [];
          if (titleChanged) changes.push('title');
          if (contentChanged) changes.push('content');
          if (summaryChanged) changes.push('summary');
          if (complexityChanged) changes.push('complexity');
          console.log(`  → Updating (changed: ${changes.join(', ')})`);
          if (!config.dryRun) {
            await updateDocument(config, existing._id, {
              title: cap.title,
              content: cap.content,
              summary: cap.summary,
              capabilityComplexity: cap.capabilityComplexity,
              tags: cap.tags,
            });
          }
          results.updated++;
        } else {
          console.log(`  → Unchanged`);
          results.unchanged++;
        }
      } else {
        console.log(`  → Creating new capability document`);
        if (!config.dryRun) {
          await createDocument(config, cap);
        }
        results.created++;
      }
    } catch (err) {
      console.error(`  → ERROR: ${err.message}`);
      results.errors.push({ capabilityId: cap.capabilityId, error: err.message });
    }
  }

  console.log('\n=== Migration Summary ===\n');
  console.log(`Created:   ${results.created}`);
  console.log(`Updated:   ${results.updated}`);
  console.log(`Unchanged: ${results.unchanged}`);
  console.log(`Errors:    ${results.errors.length}`);

  if (results.errors.length > 0) {
    console.log('\nErrors:');
    for (const err of results.errors) {
      console.log(`  - ${err.capabilityId}: ${err.error}`);
    }
  }

  if (config.dryRun) {
    console.log('\n(Dry run - no changes were made)\n');
  }

  return results;
}

// ============================================================================
// Main
// ============================================================================

const config = parseArgs();

if (!config.apiKey) {
  console.error('Error: API key required. Use --api-key or set MATRIX_API_KEY environment variable.');
  process.exit(1);
}

migrateCapabilities(config)
  .then(results => {
    process.exit(results.errors.length > 0 ? 1 : 0);
  })
  .catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
