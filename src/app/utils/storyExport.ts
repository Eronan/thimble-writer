import { zipSync } from 'fflate'

const encoder = new TextEncoder()

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    '\'': '&apos;',
  })[character] ?? character)
}

function formatOdtLine(line: string): string {
  return (line.match(/[ \t]+|[^ \t]+/g) ?? [])
    .map(part => {
      if (part.startsWith('\t')) return '<text:tab/>'.repeat(part.length)
      if (part.startsWith(' ')) {
        return part.length === 1 ? '<text:s/>' : `<text:s text:c="${part.length}"/>`
      }
      return escapeXml(part)
    })
    .join('')
}

function createContentXml(story: string): string {
  const paragraphs = story
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map(paragraph => paragraph.split('\n').map(formatOdtLine).join('<text:line-break/>'))
  const body = paragraphs.map(paragraph => `<text:p text:style-name="StoryParagraph">${paragraph}</text:p>`).join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.2">
  <office:automatic-styles>
    <style:style style:name="StoryParagraph" style:family="paragraph">
      <style:paragraph-properties fo:margin-top="0in" fo:margin-bottom="0.16in" fo:line-height="150%"/>
    </style:style>
  </office:automatic-styles>
  <office:body><office:text>${body}</office:text></office:body>
</office:document-content>`
}

export function createStoryMarkdown(story: string): Blob {
  return new Blob([story], { type: 'text/markdown;charset=utf-8' })
}

export function createStoryOdt(story: string): Blob {
  const files = {
    // ODT readers require this exact MIME entry first in the ZIP and stored without compression.
    mimetype: [encoder.encode('application/vnd.oasis.opendocument.text'), { level: 0 }],
    'content.xml': encoder.encode(createContentXml(story)),
    'styles.xml': encoder.encode(`<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" office:version="1.2">
  <office:styles/>
</office:document-styles>`),
    'META-INF/manifest.xml': encoder.encode(`<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
  <manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="application/vnd.oasis.opendocument.text"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`),
  }
  return new Blob([zipSync(files)], { type: 'application/vnd.oasis.opendocument.text' })
}

export function downloadStory(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
