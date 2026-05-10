import { promises as fs } from 'node:fs'
import { extname } from 'node:path'
import type { SessionDocument } from '../shared/types'

export async function extractDocument(filePath: string): Promise<SessionDocument> {
  const ext = extname(filePath).toLowerCase()
  const name = filePath.split(/[\\/]/).pop() ?? filePath
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

  if (ext === '.pdf') {
    const pdfParse = (await import('pdf-parse')).default
    const buf = await fs.readFile(filePath)
    const data = await pdfParse(buf)
    return { id, name, kind: 'pdf', content: data.text.trim() }
  }

  if (ext === '.docx') {
    const mammoth = await import('mammoth')
    const buf = await fs.readFile(filePath)
    const result = await mammoth.extractRawText({ buffer: buf })
    return { id, name, kind: 'docx', content: result.value.trim() }
  }

  if (ext === '.md') {
    const content = await fs.readFile(filePath, 'utf8')
    return { id, name, kind: 'md', content }
  }

  const content = await fs.readFile(filePath, 'utf8')
  return { id, name, kind: 'txt', content }
}
