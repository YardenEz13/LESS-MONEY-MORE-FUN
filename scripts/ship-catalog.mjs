#!/usr/bin/env node
/**
 * Push the current bundle, and the catalog inside it, to phones already in the
 * field. Installed apps fetch it on launch and apply it on the launch after.
 *
 * EXPO_NO_DOTENV because apps/mobile/.env holds the Gemini key the pipeline uses,
 * and Expo would inline it as EXPO_PUBLIC_*. An update is downloadable by anyone
 * who has the project id, and the repo that names the project id is public.
 */
import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const message = `catalog ${new Date().toISOString().slice(0, 10)}`;
execSync(`npx --yes eas-cli@latest update --branch production --message "${message}" --non-interactive`, {
  cwd: resolve(dirname(fileURLToPath(import.meta.url)), '../apps/mobile'),
  env: { ...process.env, EXPO_NO_DOTENV: '1', CI: '1' },
  stdio: 'inherit',
});
