const fs = require('node:fs')
const path = require('node:path')
const nodeCrypto = require('node:crypto')

const root = path.join(__dirname, '..')
const pkg = require(path.join(root, 'package.json'))

const productName = pkg.build?.productName || pkg.name || 'App'
const version = pkg.version || '0.0.0'
const distDir = path.join(root, 'dist')
const releaseRoot = path.join(root, 'release')
const releaseDir = path.join(releaseRoot, `${productName} ${version} Portable`)
const expectedExe = path.join(distDir, `${productName}-${version}-portable.exe`)

function findPortableExe() {
  if (fs.existsSync(expectedExe)) return expectedExe
  const match = fs
    .readdirSync(distDir, { withFileTypes: true })
    .find((entry) => entry.isFile() && /portable\.exe$/i.test(entry.name))
  if (!match) {
    throw new Error(`Portable executable not found in ${distDir}`)
  }
  return path.join(distDir, match.name)
}

function sha256(filePath) {
  const hash = nodeCrypto.createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

const sourceExe = findPortableExe()
fs.rmSync(releaseDir, { recursive: true, force: true })
fs.mkdirSync(releaseDir, { recursive: true })

const targetExe = path.join(releaseDir, `${productName}.exe`)
fs.copyFileSync(sourceExe, targetExe)

const digest = sha256(targetExe)
fs.writeFileSync(
  path.join(releaseDir, 'SHA256SUMS.txt'),
  `${digest}  ${path.basename(targetExe)}\n`,
  'utf8'
)

fs.writeFileSync(
  path.join(releaseDir, 'LEEME.txt'),
  [
    `${productName} Portable`,
    '',
    `Version: ${version}`,
    '',
    `Para iniciar la app, haz doble clic en "${productName}.exe".`,
    '',
    'La app es portable. Al ejecutarse, sus datos se guardan junto al ejecutable',
    `en la carpeta "${productName} Data".`,
    '',
    'No hace falta instalar Node.js ni dependencias en el PC de destino.',
    'SHA256SUMS.txt permite verificar que el ejecutable no ha cambiado.',
    ''
  ].join('\n'),
  'utf8'
)

console.log(`Release folder ready: ${releaseDir}`)
