import esbuild from 'esbuild'
import { writeFileSync, readFileSync } from 'node:fs'

// The stylesheet is fetched separately and cache-busted by CSS_VERSION. Pin it
// to the package version at build time: hand-maintaining it means shipping a
// CSS fix that every browser then ignores, which is exactly what happened
// between 0.2.3 and 0.3.1.
const { version } = JSON.parse(readFileSync('package.json', 'utf8'))

const result = await esbuild.build({
  entryPoints: ['src/client/table.js'],
  bundle: true,
  format: 'iife',
  outfile: 'client/table.js',
  sourcemap: true,
  minify: true,
  metafile: true,
  define: { __CSS_VERSION__: JSON.stringify(version) },
})

writeFileSync('meta-client.json', JSON.stringify(result.metafile))
console.log(`built client/table.js (css v${version})`)

// Modern face (Suite Quarantine migration): same core, plain ES module.
esbuild.build({
  entryPoints: ['src/client/table-modern.js'],
  bundle: true,
  format: 'esm',
  outfile: 'client/table.mjs',
  sourcemap: true,
  minify: true,
}).then(() => console.log('built client/table.mjs (modern)'))
