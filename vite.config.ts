import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? listFiles(p) : [p];
  });
}

/**
 * ビルド成果物とpublic配下を全部キャッシュする Service Worker（sw.js）を生成する。
 * 中身のハッシュをキャッシュ名に含めるので、デプロイのたびに新しい SW として検出される。
 */
function serviceWorker(): Plugin {
  let publicDir = '';
  return {
    name: 'app-service-worker',
    apply: 'build',
    configResolved(config) {
      publicDir = config.publicDir;
    },
    generateBundle(_, bundle) {
      const publicFiles = listFiles(publicDir).map((p) => relative(publicDir, p).split('\\').join('/'));
      const files = [...new Set(['./', ...Object.keys(bundle), ...publicFiles])].filter((f) => f !== 'sw.js').sort();
      const hash = createHash('sha256');
      for (const [name, chunk] of Object.entries(bundle).sort(([a], [b]) => a.localeCompare(b))) {
        hash.update(name);
        hash.update(chunk.type === 'chunk' ? chunk.code : chunk.source);
      }
      for (const f of publicFiles) hash.update(readFileSync(join(publicDir, f)));
      const version = hash.digest('hex').slice(0, 12);
      const source = readFileSync(new URL('./src/sw-template.js', import.meta.url), 'utf8')
        .replace('__CACHE_NAME__', JSON.stringify(`anki-${version}`))
        .replace('__PRECACHE__', JSON.stringify(files));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  // GitHub Pages のサブパスでもカスタムドメインでも動くよう相対パスにする
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [serviceWorker()],
  test: {
    environment: 'node',
    setupFiles: ['fake-indexeddb/auto'],
  },
});
