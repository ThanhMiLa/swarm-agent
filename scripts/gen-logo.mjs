import { Resvg } from '@resvg/resvg-js'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(resolve(root, 'src/assets/swarm-agent.svg'), 'utf8')
const appIcon = withViewBox('0 0 1254 1254')
const trayTemplate = withViewBox('158 135 944 944')
  .replace(/^  <rect .*\/>\n/m, '')
  .replace(/(<path fill=")[^"]+/, '$1#000000')

function withViewBox(viewBox) {
  return source.replace(/viewBox="[^"]+"/, `viewBox="${viewBox}"`)
}

function render(svg, size) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render()
}

// Tauri's tray image takes straight-alpha RGBA bytes. Resvg uses premultiplied alpha.
function trayRgba(svg) {
  const pixels = Buffer.from(render(svg, 32).pixels)
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3]
    if (alpha === 0 || alpha === 255) continue
    for (let channel = 0; channel < 3; channel++) {
      pixels[i + channel] = Math.round((pixels[i + channel] * 255) / alpha)
    }
  }
  return pixels
}

function write(path, data) {
  writeFileSync(resolve(root, path), data)
}

write('public/favicon.svg', source)
write('docs/images/swarm-agent.png', render(source, 256).asPng())
write('src-tauri/icon-source.svg', appIcon)
write('src-tauri/icon-source.png', render(appIcon, 1024).asPng())
write('src-tauri/icons/tray-template-32.rgba', trayRgba(trayTemplate))
write('src-tauri/icons/tray-color-32.rgba', trayRgba(source))

if (!process.argv.includes('--no-icons')) {
  const cli = resolve(root, 'node_modules/@tauri-apps/cli/tauri.js')
  execFileSync(
    process.execPath,
    [cli, 'icon', 'src-tauri/icon-source.png', '-o', 'src-tauri/icons', '--ios-color', '#090E0B'],
    { cwd: root, stdio: 'inherit' }
  )
}
