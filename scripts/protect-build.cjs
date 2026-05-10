const fs = require('node:fs')
const path = require('node:path')
const JavaScriptObfuscator = require('javascript-obfuscator')

const root = path.join(__dirname, '..')
const outDir = path.join(root, 'out')

const OPTIONS = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: true,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  selfDefending: false,
  simplify: true,
  splitStrings: false,
  stringArray: true,
  stringArrayCallsTransform: false,
  stringArrayEncoding: ['base64'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayThreshold: 0.75,
  target: 'node'
}

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(fullPath, files)
    } else if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.endsWith('.min.js')) {
      files.push(fullPath)
    }
  }
  return files
}

function protectFile(filePath) {
  const source = fs.readFileSync(filePath, 'utf8')
  if (source.includes('/* protected-build */')) return
  const result = JavaScriptObfuscator.obfuscate(source, {
    ...OPTIONS,
    sourceMap: false,
    target: filePath.includes(`${path.sep}renderer${path.sep}`) ? 'browser' : 'node'
  })
  fs.writeFileSync(
    filePath,
    `/* protected-build */\n${result.getObfuscatedCode()}\n`,
    'utf8'
  )
}

const files = walk(outDir)
for (const file of files) protectFile(file)
console.log(`Protected ${files.length} JavaScript bundle(s).`)
