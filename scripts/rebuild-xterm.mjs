/** Rebuild the pinned xterm renderer packages into both entrypoints.
 * Regenerate the patches with `npx patch-package @xterm/xterm @xterm/addon-webgl`. */
import { build } from 'esbuild'
import path from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
const root = path.resolve('node_modules/@xterm/xterm')
const packages = [
  { name: 'xterm', version: '6.0.0', exportName: 'Terminal', source: './browser/public/Terminal' },
  { name: 'addon-webgl', version: '0.19.0', exportName: 'WebglAddon', source: './WebglAddon' }
]
const alias = Object.fromEntries(['browser', 'common', 'vs'].map(p => [p, path.join(root, 'src', p)]))

for (const { name, version, exportName, source } of packages) {
  const packageRoot = path.resolve('node_modules/@xterm', name)
  if (JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8')).version !== version) {
    throw new Error(`Review the patch before changing @xterm/${name} from ${version}`)
  }
  for (const [format, extension] of [['esm', 'mjs'], ['cjs', 'js']]) {
    const result = await build({
      stdin: { contents: `export { ${exportName} } from '${source}'`, resolveDir: path.join(packageRoot, 'src'), loader: 'ts' },
      bundle: true, write: false, platform: 'browser', format, minify: true, target: 'es2020', legalComments: 'eof',
      // Preserve Node's named ESM imports from the CommonJS entrypoint too.
      footer: format === 'cjs' ? { js: `0 && (module.exports = { ${exportName} });` } : undefined,
      alias,
      tsconfigRaw: { compilerOptions: { experimentalDecorators: true } }
    })
    const file = path.join(packageRoot, 'lib', `${name}.${extension}`)
    writeFileSync(file, result.outputFiles[0].contents)
    console.log(`@xterm/${name} ${extension}: ${result.outputFiles[0].contents.length} bytes`)
  }
}
