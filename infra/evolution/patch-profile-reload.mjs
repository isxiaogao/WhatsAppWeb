import { readFileSync, writeFileSync } from 'node:fs'

const bundlePath = '/evolution/dist/main.js'
let bundle = readFileSync(bundlePath, 'utf8')

const replacements = [
  [
    'await this.client.updateProfilePicture(this.instance.wuid,t),this.reloadConnection(),{update:"success"}',
    'await this.client.updateProfilePicture(this.instance.wuid,t),{update:"success"}',
  ],
  [
    'await this.client.removeProfilePicture(this.instance.wuid),this.reloadConnection(),{update:"success"}',
    'await this.client.removeProfilePicture(this.instance.wuid),{update:"success"}',
  ],
]

for (const [unsafeCode, safeCode] of replacements) {
  const matches = bundle.split(unsafeCode).length - 1
  if (matches !== 1) {
    throw new Error(`Expected one Evolution v2.3.7 profile reload call, found ${matches}`)
  }
  bundle = bundle.replace(unsafeCode, safeCode)
}

writeFileSync(bundlePath, bundle, 'utf8')
console.log('Patched Evolution v2.3.7 profile updates to preserve the active Baileys socket')

