const pkg = require('./package.json')

const build = structuredClone(pkg.build)
build.win = {
  ...(build.win || {}),
  signAndEditExecutable: true
}

function requireAnyEnv(...names) {
  const found = names.find((name) => process.env[name]?.trim())
  if (!found) throw new Error(`Missing required environment variable: ${names.join(' or ')}`)
  const value = process.env[found]?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${found}`)
  return value
}

function hasEnv(name) {
  return Boolean(process.env[name]?.trim())
}

const mode = (process.env.WINDOWS_SIGNING_MODE || '').trim().toLowerCase()
const wantsAzure =
  mode === 'azure' ||
  hasEnv('AZURE_SIGNING_ENDPOINT') ||
  hasEnv('AZURE_TRUSTED_SIGNING_ENDPOINT')
const hasPfx = hasEnv('CSC_LINK') || hasEnv('WIN_CSC_LINK')

if (wantsAzure) {
  build.win.azureSignOptions = {
    endpoint: requireAnyEnv('AZURE_SIGNING_ENDPOINT', 'AZURE_TRUSTED_SIGNING_ENDPOINT'),
    codeSigningAccountName: requireAnyEnv(
      'AZURE_SIGNING_ACCOUNT',
      'AZURE_TRUSTED_SIGNING_ACCOUNT'
    ),
    certificateProfileName: requireAnyEnv(
      'AZURE_SIGNING_PROFILE',
      'AZURE_TRUSTED_SIGNING_PROFILE'
    ),
    publisherName: requireAnyEnv('AZURE_SIGNING_PUBLISHER', 'AZURE_TRUSTED_SIGNING_PUBLISHER'),
    fileDigest: 'SHA256',
    timestampDigest: 'SHA256',
    timestampRfc3161: 'http://timestamp.acs.microsoft.com'
  }
} else if (!hasPfx) {
  throw new Error(
    'No Windows signing credentials found. Set Azure Artifact Signing variables or CSC_LINK + CSC_KEY_PASSWORD.'
  )
}

module.exports = build
