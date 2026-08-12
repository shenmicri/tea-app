const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function evaluateSchema() {
  const source = fs.readFileSync(path.join(process.cwd(), 'config/schema.js'), 'utf8')
    .replace(/export const /g, 'const ')
    .replace(/export function /g, 'function ')
  return new Function(`${source}\nreturn { SECTIONS, createEmptySections, findMissingRequired }`)()
}

function setAtPath(target, rawPath, value) {
  const keys = rawPath.replace(/\[(\d+)\]/g, '.$1').split('.')
  let cursor = target
  keys.slice(0, -1).forEach(key => {
    if (cursor[key] === undefined) cursor[key] = {}
    cursor = cursor[key]
  })
  cursor[keys[keys.length - 1]] = value
}

function instantiate(definition) {
  const instance = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data))
  }
  instance.setData = function setData(updates, callback) {
    Object.entries(updates).forEach(([key, value]) => setAtPath(this.data, key, value))
    if (callback) callback()
  }
  return instance
}

function evaluatePage(file, dependencyNames, dependencies) {
  let definition
  const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8')
    .replace(/^import .*$/gm, '')
  new Function(...dependencyNames, 'Page', source)(
    ...dependencies,
    value => { definition = value }
  )
  return definition
}

function completeSections(schema) {
  const sections = schema.createEmptySections()
  sections.basic.name = '白牡丹'
  sections.basic.category = '白茶'
  sections.basic.coverImage = '/tests/fixtures/white-peony-hero.jpg'
  sections.basic.summary = '柔雅花香，清甜如初春。'
  return sections
}

async function flush() {
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))
}

async function runEditTests(schema) {
  const saves = []
  const calls = { modal: [], toast: [], redirect: [], preview: [] }
  const wx = {
    setNavigationBarTitle() {},
    showLoading() {},
    hideLoading() {},
    showModal(options) { calls.modal.push(options) },
    showToast(options) { calls.toast.push(options) },
    redirectTo(options) { calls.redirect.push(options) },
    showActionSheet(options) { options.success({ tapIndex: 0 }) },
    chooseMedia(options) {
      options.success({ tempFiles: [{ tempFilePath: 'tmp-image.jpg' }] })
    },
    saveFile(options) {
      options.success({ savedFilePath: `saved://${options.tempFilePath}` })
    }
  }
  async function saveArchive(data) {
    saves.push(data)
    return {
      id: data.id || 'archive01',
      createdAt: data.createdAt || 123,
      status: data.status,
      sections: data.sections,
      customSections: data.customSections
    }
  }
  const definition = evaluatePage(
    'pages/edit/edit.js',
    ['SECTIONS', 'createEmptySections', 'findMissingRequired', 'getArchive', 'saveArchive', 'wx'],
    [schema.SECTIONS, schema.createEmptySections, schema.findMissingRequired, async () => null, saveArchive, wx]
  )
  const page = instantiate(definition)

  await page.onSaveDraft()
  assert.equal(saves.at(-1).status, 'draft')
  assert.equal(page.data.id, 'archive01')

  const savesBeforeIncompleteGenerate = saves.length
  await page.onGenerate()
  assert.equal(saves.length, savesBeforeIncompleteGenerate)
  assert.equal(calls.modal.at(-1).title, '还不能生成档案')

  page.data.sections = completeSections(schema)
  page.refreshCanGenerate()
  assert.equal(page.data.canGenerate, true)
  await page.onGenerate()
  assert.equal(saves.at(-1).status, 'published')
  assert.equal(calls.redirect.at(-1).url, '/pages/qrcode/qrcode?id=archive01')

  page.onCoverAdd({ currentTarget: { dataset: { section: 'basic', field: 'coverImage' } } })
  await flush()
  assert.equal(page.data.sections.basic.coverImage, 'saved://tmp-image.jpg')

  page.onMediaAdd({ currentTarget: { dataset: { section: 'feature', field: 'media' } } })
  await flush()
  assert.equal(page.data.sections.feature.media.length, 1)
  assert.equal(page.data.sections.feature.media[0].type, 'image')
  assert.equal(page.data.sections.feature.media[0].path, 'saved://tmp-image.jpg')
}

async function runArchiveTests(schema) {
  const previewCalls = []
  const sections = completeSections(schema)
  sections.feature.profile = '芽叶连枝，银毫披覆。'
  sections.feature.media = [{
    id: 'media-one',
    type: 'image',
    path: '/tests/fixtures/white-peony-leaves.jpg',
    poster: '',
    duration: 0
  }]
  sections.brand.brandName = '春山茶事'

  const archive = {
    id: 'archive01',
    name: '白牡丹',
    status: 'published',
    sections,
    customSections: []
  }
  const wx = {
    setNavigationBarTitle() {},
    previewImage(options) { previewCalls.push(options) }
  }
  const definition = evaluatePage(
    'pages/archive/archive.js',
    ['SECTIONS', 'getArchive', 'wx'],
    [schema.SECTIONS, async () => archive, wx]
  )
  const page = instantiate(definition)
  await page.onLoad({ id: 'archive01' })

  assert.equal(page.data.found, true)
  assert.equal(page.data.displaySections.length, 3)
  assert.deepEqual(page.data.displaySections.map(section => section.empty), [false, true, false])
  assert.deepEqual(page.data.displaySections[0].fields.map(field => field.key), ['profile', 'media'])
  assert.deepEqual(page.data.expanded, {})

  page.onToggleSection({ currentTarget: { dataset: { key: 'origin', empty: true } } })
  assert.equal(page.data.expanded.origin, undefined)
  page.onToggleSection({ currentTarget: { dataset: { key: 'feature', empty: false } } })
  assert.equal(page.data.expanded.feature, true)

  page.onPreviewImage({ currentTarget: { dataset: { current: '/tests/fixtures/white-peony-leaves.jpg' } } })
  assert.equal(previewCalls.at(-1).current, '/tests/fixtures/white-peony-leaves.jpg')
}

async function run() {
  const schema = evaluateSchema()
  await runEditTests(schema)
  await runArchiveTests(schema)
  console.log('passed: editor draft/generate/media and archive folding/empty/preview behavior')
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
