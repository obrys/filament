import { inflateSync } from 'node:zlib'

/**
 * Minimal PDF inspection for label PDFs produced by the API.
 *
 * Relies on the exact output format QuestPDF 2024.12.0 generates from this
 * codebase (verified against real generated files):
 *  - the page tree is plain (uncompressed): `/Type /Pages … /Count N … /Kids [a 0 R b 0 R]`
 *    and `/Kids` lists the pages in order;
 *  - every page's `/Contents` is a single `N 0 R` reference to a `FlateDecode`
 *    stream without predictor (plain zlib);
 *  - each label's QR code is one image XObject invocation (`/Xn Do`) in the
 *    page's content stream — one reference per label even for identical labels;
 *  - text is written as `<hex> Tj` inside `BT…ET` blocks with `/Fn Tf` font
 *    selections, and every font subset carries a standard `/ToUnicode` CMap
 *    (`beginbfchar` / `beginbfrange`) mapping 2-byte glyph ids to Unicode.
 *
 * Node built-ins only (zlib) — no external dependencies.
 */

export type PdfPage = {
  /** Decoded label text of the page, in content-stream (drawing) order. */
  text: string
  /** Number of image XObject invocations — one per label's QR code. */
  labelCount: number
}

type PdfObject = {
  num: number
  body: Buffer
  bodyText: string
}

/**
 * Sequential object scanner. Walks the file in order, and when an object carries a
 * `stream` payload the scanner skips the exact `/Length` bytes of binary data before
 * looking for the object's `endobj` marker. This keeps binary stream contents (QR
 * image data, Flate streams) from ever being mistaken for object syntax such as
 * `N 0 obj`, `/Type /Pages` or `endobj`.
 */
function splitObjects(bytes: Buffer): Map<number, PdfObject> {
  const objects = new Map<number, PdfObject>()
  const s = bytes.toString('latin1')
  const header = /(\d+) 0 obj\b/g
  let pos = 0
  while (pos < s.length) {
    header.lastIndex = pos
    const m = header.exec(s)
    if (m === null) break
    const num = Number(m[1])
    const bodyStart = header.lastIndex
    let end = s.indexOf('endobj', bodyStart)
    if (end === -1) break
    const streamAt = s.indexOf('stream', bodyStart)
    if (streamAt !== -1 && streamAt < end) {
      const lengthMatch = /\/Length\s+(\d+)/.exec(s.slice(bodyStart, streamAt))
      const keyword = /^stream\r?\n/.exec(s.slice(streamAt))
      const streamDataStart = streamAt + (keyword ? keyword[0].length : 0)
      const streamDataEnd = streamDataStart + (lengthMatch ? Number(lengthMatch[1]) : 0)
      const endstreamAt = s.indexOf('endstream', streamDataEnd)
      if (endstreamAt !== -1) end = s.indexOf('endobj', endstreamAt)
      if (end === -1) break
    }
    if (!objects.has(num))
      objects.set(num, {
        num,
        body: bytes.subarray(bodyStart, end),
        bodyText: s.slice(bodyStart, end),
      })
    pos = end + 'endobj'.length
  }
  return objects
}

function extractStream(object: PdfObject): Buffer | null {
  const text = object.bodyText
  const i = text.indexOf('stream')
  if (i === -1) return null
  const header = /^stream\r?\n/.exec(text.slice(i))
  if (!header) return null
  const lengthMatch = /\/Length\s+(\d+)/.exec(text.slice(0, i))
  if (!lengthMatch) return null
  return object.body.subarray(i + header[0].length, i + header[0].length + Number(lengthMatch[1]))
}

function decodeStream(raw: Buffer): Buffer {
  try {
    return inflateSync(raw)
  } catch {
    return raw // tolerate uncompressed streams
  }
}

function hexToUnicode(hex: string): string {
  let out = ''
  for (let i = 0; i + 4 <= hex.length; i += 4)
    out += String.fromCharCode(Number.parseInt(hex.slice(i, i + 4), 16))
  return out
}

/** Parses a `/ToUnicode` CMap body into a glyph-id → Unicode text map. */
function parseCMap(text: string): Map<number, string> {
  const map = new Map<number, string>()
  for (const section of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of section[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g))
      map.set(Number.parseInt(pair[1], 16), hexToUnicode(pair[2]))
  }
  for (const section of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const range of section[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const lo = Number.parseInt(range[1], 16)
      const hi = Number.parseInt(range[2], 16)
      let dst = hexToUnicode(range[3])
      for (let code = lo; code <= hi; code++) {
        map.set(code, dst)
        dst = [...dst].map(ch => String.fromCharCode(ch.charCodeAt(0) + 1)).join('')
      }
    }
  }
  return map
}

function fontCMap(objects: Map<number, PdfObject>, fontRef: number): Map<number, string> | null {
  const fontObject = objects.get(fontRef)
  if (!fontObject) return null
  const toUnicodeRef = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(fontObject.bodyText)?.[1]
  if (!toUnicodeRef) return null
  const cmapObject = objects.get(Number(toUnicodeRef))
  const stream = cmapObject && extractStream(cmapObject)
  return cmapObject && stream ? parseCMap(decodeStream(stream).toString('latin1')) : null
}

function pageFontMaps(objects: Map<number, PdfObject>, page: PdfObject): Map<string, Map<number, string>> {
  const fonts = new Map<string, Map<number, string>>()
  const fontSection = /\/Font\s*<<(.*?)>>/s.exec(page.bodyText)
  if (!fontSection) return fonts
  for (const m of fontSection[1].matchAll(/\/(\w+)\s+(\d+)\s+0\s+R/g)) {
    const cmap = fontCMap(objects, Number(m[2]))
    if (cmap) fonts.set(m[1], cmap)
  }
  return fonts
}

function pageText(content: string, fonts: Map<string, Map<number, string>>): string {
  let text = ''
  let current: Map<number, string> | null = null
  for (const block of content.matchAll(/BT([\s\S]*?)ET/g)) {
    for (const op of block[1].matchAll(/(\/(\w+)\s+(?:[\d.]+\s+)?Tf)|<([0-9A-Fa-f]+)>\s*Tj/g)) {
      if (op[2] !== undefined) {
        current = fonts.get(op[2]) ?? null
      } else if (op[3] !== undefined && current) {
        for (let i = 0; i + 4 <= op[3].length; i += 4)
          text += current.get(Number.parseInt(op[3].slice(i, i + 4), 16)) ?? ''
      }
    }
  }
  return text
}

function pageLabelCount(content: string): number {
  return (content.match(/\/\w+\s+Do/g) ?? []).length
}

/** Splits the PDF into its pages (in order) with decoded label text and label counts. */
export function pdfPages(bytes: Buffer): PdfPage[] {
  const objects = splitObjects(bytes)
  const pagesRoot = [...objects.values()].find(o => /\/Type \/Pages\b/.test(o.bodyText))
  if (!pagesRoot) throw new Error('pdfPages: no /Type /Pages object found')
  const kidsMatch = /\/Kids\s*\[([^\]]*)\]/.exec(pagesRoot.bodyText)
  if (!kidsMatch) throw new Error('pdfPages: page tree has no /Kids')
  const kidRefs = [...kidsMatch[1].matchAll(/(\d+)\s+0\s+R/g)].map(m => Number(m[1]))
  return kidRefs.map(ref => {
    const page = objects.get(ref)
    if (!page) throw new Error(`pdfPages: missing page object ${ref}`)
    const contentMatch = /\/Contents\s+(?:(\d+)\s+0\s+R|\[([^\]]*)\])/.exec(page.bodyText)
      ?? (() => { throw new Error(`pdfPages: page ${ref} has no /Contents`) })()
    const contentRefs = contentMatch[1] !== undefined
      ? [Number(contentMatch[1])]
      : [...contentMatch[2].matchAll(/(\d+)\s+0\s+R/g)].map(m => Number(m[1]))
    const content = contentRefs
      .map(ref => objects.get(ref))
      .filter(o => o !== undefined)
      .map(o => decodeStream(extractStream(o!)! ).toString('latin1'))
      .join('')
    return { text: pageText(content, pageFontMaps(objects, page)), labelCount: pageLabelCount(content) }
  })
}

/** Number of pages in the PDF. */
export function pdfPageCount(bytes: Buffer): number {
  return pdfPages(bytes).length
}

/** How many times `needle` occurs (non-overlapping) in `text`. */
export function countOccurrences(text: string, needle: string): number {
  let count = 0
  let i = text.indexOf(needle)
  while (i !== -1) {
    count++
    i = text.indexOf(needle, i + needle.length)
  }
  return count
}

/** The ids found in `text`, in order of first occurrence position (each occurrence counted). */
export function idOrderInText(text: string, ids: string[]): string[] {
  const events: { pos: number; id: string }[] = []
  for (const id of ids) {
    let i = text.indexOf(id)
    while (i !== -1) {
      events.push({ pos: i, id })
      i = text.indexOf(id, i + 1)
    }
  }
  events.sort((a, b) => a.pos - b.pos)
  return events.map(e => e.id)
}
