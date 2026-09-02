const baseUrl = (process.env.EVOLUTION_API_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '')
const apiKey = process.env.EVOLUTION_API_KEY ?? 'local-mvp-evolution-key'

const rootResponse = await fetch(`${baseUrl}/`)
if (!rootResponse.ok) throw new Error(`Evolution root endpoint returned ${rootResponse.status}`)

const instancesResponse = await fetch(`${baseUrl}/instance/fetchInstances`, {
  headers: { apikey: apiKey },
})
if (!instancesResponse.ok) {
  throw new Error(`Evolution authenticated endpoint returned ${instancesResponse.status}`)
}
const instances = await instancesResponse.json()
if (!Array.isArray(instances)) throw new Error('Evolution returned an invalid instance list')

console.log(`Evolution API is ready at ${baseUrl}; ${instances.length} instance(s) found.`)
