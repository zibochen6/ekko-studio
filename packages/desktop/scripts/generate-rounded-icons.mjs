// One transparent master supplies every first-party brand image. Run from any OS:
// node packages/desktop/scripts/generate-rounded-icons.mjs
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const buildDir = new URL('../build/', import.meta.url)
const publicDir = new URL('../../client/public/', import.meta.url)
const master = fileURLToPath(new URL('brand/master.png', buildDir))
// The artwork already contains the rounded tile. Trim only transparent canvas;
// applying another rounded mask would clip the bevel at small sizes.
const tile = await sharp(master).trim({ threshold: 1 }).png().toBuffer()
async function render(size, padding = 0, background = '#00000000') {
  const inset = Math.round(size * padding)
  return sharp(tile)
    .resize(size - inset * 2, size - inset * 2, { fit: 'contain', background })
    .extend({ top: inset, bottom: inset, left: inset, right: inset, background })
    .png().toBuffer()
}

function ico(sizes, entries) {
  const header = Buffer.alloc(6 + 16 * entries.length)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)
  let offset = header.length
  entries.forEach((image, index) => {
    const entry = 6 + index * 16
    header[entry] = sizes[index] === 256 ? 0 : sizes[index]
    header[entry + 1] = header[entry]
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(image.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += image.length
  })
  return Buffer.concat([header, ...entries])
}

await mkdir(new URL('icons/', buildDir), { recursive: true })
await writeFile(new URL('icon.png', buildDir), await render(1024, 1 / 16))
for (const size of [16, 32, 48, 64, 128, 256, 512]) {
  const icon = await render(size, 1 / 16)
  await writeFile(new URL(`icons/${size}x${size}.png`, buildDir), icon)
  if (size === 512) await writeFile(new URL('iconLinux.png', buildDir), icon)
}
await writeFile(new URL('iconWindows.png', buildDir), await render(1024))
for (const [name, size] of [['trayMac.png', 22], ['trayMac@2x.png', 44], ['trayWindows.png', 256], ['trayLinux.png', 256]]) {
  await writeFile(new URL(name, buildDir), await render(size))
}
const sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
await writeFile(new URL('icon.ico', buildDir), ico(sizes, await Promise.all(sizes.map(size => render(size)))))

// Icon Composer owns the macOS exterior mask. Opaque black full-bleed avoids
// placing our tile on a second white rounded plate on Tahoe.
const composer = await sharp(await render(1024)).flatten({ background: '#171719' }).png().toBuffer()
await writeFile(new URL('icon.icon/Assets/hermes-logo.png', buildDir), composer)
// PNG-backed ICNS also supports older macOS, deterministically on all build OSs.
const chunks = []
for (const [type, size] of [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]]) {
  const image = await render(size, 1 / 16)
  const header = Buffer.alloc(8)
  header.write(type)
  header.writeUInt32BE(image.length + 8, 4)
  chunks.push(header, image)
}
const icnsHeader = Buffer.alloc(8)
icnsHeader.write('icns')
icnsHeader.writeUInt32BE(8 + chunks.reduce((total, chunk) => total + chunk.length, 0), 4)
await writeFile(new URL('icon.icns', buildDir), Buffer.concat([icnsHeader, ...chunks]))

const webLogo = await render(512)
for (const name of ['logo.png', 'logo-original.png', 'coding-agents/ekko-agent.png', 'coding-agents/hermes.png']) {
  await writeFile(new URL(name, publicDir), webLogo)
}
await writeFile(new URL('apple-touch-icon.png', publicDir), await sharp(await render(180, 0.08, '#171719')).flatten({ background: '#171719' }).png().toBuffer())
await writeFile(new URL('logo-maskable.png', publicDir), await sharp(await render(512, 0.16, '#171719')).flatten({ background: '#171719' }).png().toBuffer())
const faviconSizes = [16, 32, 48, 64, 128, 256]
await writeFile(new URL('favicon.ico', publicDir), ico(faviconSizes, await Promise.all(faviconSizes.map(size => render(size)))))
