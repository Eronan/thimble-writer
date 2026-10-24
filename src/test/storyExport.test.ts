import assert from 'node:assert/strict'
import test from 'node:test'
import { unzipSync } from 'fflate'
import { createStoryMarkdown, createStoryOdt } from '../app/utils/storyExport.ts'

test('Markdown export retains the story text exactly', async () => {
  const story = 'A line with **Markdown**.\n\n  Indented ending.  '
  const blob = createStoryMarkdown(story)
  assert.equal(blob.type, 'text/markdown;charset=utf-8')
  assert.equal(await blob.text(), story)
})

test('Markdown export adds the chapter title as a heading', async () => {
  const blob = createStoryMarkdown('Chapter prose.', 'The <Long> Night')
  assert.equal(await blob.text(), '# The <Long> Night\n\nChapter prose.')
})

test('ODT export creates a valid archive with escaped, paragraph-preserving story text', async () => {
  const blob = createStoryOdt('First <scene>.\ncontinued.\n\nA  second & final scene.')
  assert.equal(blob.type, 'application/vnd.oasis.opendocument.text')

  const archive = unzipSync(new Uint8Array(await blob.arrayBuffer()))
  assert.equal(new TextDecoder().decode(archive.mimetype), 'application/vnd.oasis.opendocument.text')
  const content = new TextDecoder().decode(archive['content.xml'])
  assert.match(content, /fo:margin-bottom="0\.16in"/)
  assert.match(content, /fo:line-height="150%"/)
  assert.match(content, /<text:p text:style-name="StoryParagraph">First<text:s\/>&lt;scene&gt;\.<text:line-break\/>continued\.<\/text:p>/)
  assert.match(content, /<text:p text:style-name="StoryParagraph">A<text:s text:c="2"\/>second<text:s\/>&amp;<text:s\/>final<text:s\/>scene\.<\/text:p>/)
  assert.ok(archive['META-INF/manifest.xml'])

  const bytes = new Uint8Array(await blob.arrayBuffer())
  const nameLength = bytes[26]! | (bytes[27]! << 8)
  assert.equal(new TextDecoder().decode(bytes.slice(30, 30 + nameLength)), 'mimetype')
  assert.equal(bytes[8]! | (bytes[9]! << 8), 0)
})

test('ODT export adds an escaped chapter title heading before the story', async () => {
  const blob = createStoryOdt('Chapter prose.', 'The <Long> Night & Dawn')
  const archive = unzipSync(new Uint8Array(await blob.arrayBuffer()))
  const content = new TextDecoder().decode(archive['content.xml'])
  assert.match(content, /<text:h text:outline-level="1" text:style-name="ChapterTitle">The &lt;Long&gt; Night &amp; Dawn<\/text:h>/)
  assert.ok(content.indexOf('<text:h text:outline-level') < content.indexOf('<text:p text:style-name="StoryParagraph">'))
})
