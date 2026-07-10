// Converts the OpenAPI YAML spec to JSON for tools that require JSON input
// (e.g. Copilot Studio's "REST API" tool). Run: `npm run openapi:json`.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import YAML from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
const yamlPath = join(here, '..', 'openapi', 'msx-milestone-assistant.openapi.yaml');
const jsonPath = join(here, '..', 'openapi', 'msx-milestone-assistant.openapi.json');

const doc = YAML.parse(readFileSync(yamlPath, 'utf8'));
writeFileSync(jsonPath, JSON.stringify(doc, null, 2) + '\n', 'utf8');
console.log(`Wrote ${jsonPath}`);
