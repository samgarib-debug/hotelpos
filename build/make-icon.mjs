import { readFileSync, writeFileSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'
import pngToIco from 'png-to-ico'

const svg = readFileSync(new URL('./icon.svg', import.meta.url))

function png(size) {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: size } })
  return Buffer.from(r.render().asPng())
}

// PNGs for the .ico (Windows picks the best size per context)
const sizes = [16, 24, 32, 48, 64, 128, 256]
const pngs = sizes.map(png)

writeFileSync(new URL('./icon-512.png', import.meta.url), png(512))
writeFileSync(new URL('./icon-256.png', import.meta.url), pngs[pngs.length - 1])

const ico = await pngToIco(pngs)
writeFileSync(new URL('./icon.ico', import.meta.url), ico)
console.log('wrote icon.ico:', ico.length, 'bytes; sizes:', sizes.join(','))
