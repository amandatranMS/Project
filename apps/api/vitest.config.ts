import { defineConfig } from 'vitest/config';

/**
 * The API is ESM + NodeNext, so its source imports carry explicit `.js`
 * extensions that actually refer to `.ts` files on disk. Vite does not remap
 * those by default, so this plugin rewrites relative `./x.js` specifiers to
 * `./x.ts` when the TypeScript file exists.
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const resolveTsFromJs = {
  name: 'resolve-ts-from-js',
  enforce: 'pre' as const,
  resolveId(source: string, importer?: string) {
    if (!importer || !source.startsWith('.') || !source.endsWith('.js')) return null;
    const candidate = resolve(dirname(importer), source.slice(0, -3) + '.ts');
    return existsSync(candidate) ? candidate : null;
  },
};

export default defineConfig({
  plugins: [resolveTsFromJs],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    restoreMocks: true,
  },
});
