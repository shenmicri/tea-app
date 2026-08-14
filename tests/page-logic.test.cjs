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
      return options.success({ tempFiles: [{ tempFilePath: 'tmp-image.jpg' }] })
    },
    compressImage(options) {
      options.success({ tempFilePath: options.src })
    },
    getImageInfo(options) {
      options.success({ width: 1200, height: 900, type: 'jpeg' })
    },
    cloud: {
      uploadFile(options) {
        const result = { fileID: `cloud://test/${options.filePath}` }
        options.success(result)
        return Promise.resolve(result)
      }
    }
  }
  async function saveArchive(data) {
    saves.push(data)
    return {
      id: data.id || 'archive01',
      createdAt: data.createdAt || 123,
      revision: (data.revision || 0) + 1,
      status: data.status,
      sections: data.sections,
      customSections: data.customSections
    }
  }
  const definition = evaluatePage(
    'pages/edit/edit.js',
    ['SECTIONS', 'createEmptySections', 'findMissingRequired', 'getArchive', 'saveArchive', 'startArchiveDraft', 'wx'],
    [
      schema.SECTIONS,
      schema.createEmptySections,
      schema.findMissingRequired,
      async () => null,
      saveArchive,
      async () => ({ id: 'archive01', revision: 0, uploadToken: 'archive-upload-token' }),
      wx
    ]
  )
  const page = instantiate(definition)
  page.data.id = 'archive01'
  page.data.initializing = false
  page.data.uploadToken = 'archive-upload-token'

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

  const redirectsBeforeSecurityFailure = calls.redirect.length
  const originalSaveArchive = page.persist
  page.persist = async () => {
    const error = new Error('档案文字未通过安全检测，请检查并修改后重试')
    error.code = 'TEXT_CONTENT_RISKY'
    throw error
  }
  await page.onGenerate()
  assert.equal(calls.redirect.length, redirectsBeforeSecurityFailure)
  assert.equal(calls.modal.at(-1).title, '内容未通过安全检测')
  assert.equal(page.data.saving, false)
  page.persist = originalSaveArchive

  await page.onCoverAdd({ currentTarget: { dataset: { section: 'basic', field: 'coverImage' } } })
  await flush()
  assert.equal(page.data.sections.basic.coverImage, 'tmp-image.jpg')
  assert.equal(page.data.sections.basic.coverImageFileId, 'cloud://test/tmp-image.jpg')

  await page.onMediaAdd({ currentTarget: { dataset: { section: 'feature', field: 'media' } } })
  await flush()
  assert.equal(page.data.sections.feature.media.length, 1)
  assert.equal(page.data.sections.feature.media[0].type, 'image')
  assert.equal(page.data.sections.feature.media[0].path, 'tmp-image.jpg')
  assert.equal(page.data.sections.feature.media[0].fileId, 'cloud://test/tmp-image.jpg')

  page.data.customSections = Array.from({ length: 20 }, (_, index) => ({
    id: `custom-${index}`,
    title: '',
    content: ''
  }))
  page.onCustomAdd()
  assert.equal(page.data.customSections.length, 20)
  assert.equal(calls.toast.at(-1).title, '最多只能添加20个自定义项目')

  page.data.customSections = [{ id: 'custom-invalid', title: '', content: '有内容但没有标题' }]
  const savesBeforeInvalidCustom = saves.length
  await page.onGenerate()
  assert.equal(saves.length, savesBeforeInvalidCustom)
  assert.equal(calls.modal.at(-1).content, '有内容的自定义项目需要填写标题。当前内容仍可保存为草稿。')
}

async function runArchiveTests(schema) {
  const previewCalls = []
  const recordedViews = []
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
    ['SECTIONS', 'getPublicArchive', 'recordArchiveView', 'wx'],
    [schema.SECTIONS, async () => archive, async id => { recordedViews.push(id) }, wx]
  )
  const page = instantiate(definition)
  await page.onLoad({ id: 'archive01' })

  assert.equal(page.data.found, true)
  assert.equal(page.data.displaySections.length, 3)
  assert.deepEqual(page.data.displaySections.map(section => section.empty), [false, true, false])
  assert.deepEqual(page.data.displaySections[0].fields.map(field => field.key), ['profile', 'media'])
  assert.deepEqual(page.data.expanded, {})
  assert.deepEqual(recordedViews, ['archive01'])

  page.onToggleSection({ currentTarget: { dataset: { key: 'origin', empty: true } } })
  assert.equal(page.data.expanded.origin, undefined)
  page.onToggleSection({ currentTarget: { dataset: { key: 'feature', empty: false } } })
  assert.equal(page.data.expanded.feature, true)

  page.onPreviewImage({ currentTarget: { dataset: { current: '/tests/fixtures/white-peony-leaves.jpg' } } })
  assert.equal(previewCalls.at(-1).current, '/tests/fixtures/white-peony-leaves.jpg')
}

async function runHomeAndHistoryTests() {
  const navigations = []
  const wx = {
    navigateTo(options) { navigations.push(options.url) }
  }
  const homeDefinition = evaluatePage('pages/index/index.js', ['wx'], [wx])
  const home = instantiate(homeDefinition)
  home.onCreateTap()
  home.onHistoryTap()
  assert.deepEqual(navigations, ['/pages/list/list', '/pages/history/history'])

  const historyDefinition = evaluatePage(
    'pages/history/history.js',
    ['listViewHistory', 'wx'],
    [async () => [{
      id: 'archive01',
      name: '白牡丹',
      category: '白茶',
      lastViewedAt: Date.parse('2026-08-14T09:30:00-04:00')
    }], wx]
  )
  const history = instantiate(historyDefinition)
  await history.load()
  assert.equal(history.data.records.length, 1)
  assert.equal(history.data.records[0].name, '白牡丹')
  assert.equal(history.data.records[0].category, '白茶')
  assert.match(history.data.records[0].viewedText, /^2026-08-14 09:30$/)
  assert.equal(Object.hasOwn(history.data.records[0], 'coverImage'), false)
  history.onRecordTap({ currentTarget: { dataset: { id: 'archive01' } } })
  assert.equal(navigations.at(-1), '/pages/archive/archive?id=archive01')

  const appConfig = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'app.json'), 'utf8'))
  assert.equal(appConfig.pages[0], 'pages/index/index')
  assert.ok(appConfig.pages.includes('pages/history/history'))
}

async function runQrCodeTests() {
  const calls = { navigate: [], saved: [], toast: [] }
  const wx = {
    navigateTo(options) { calls.navigate.push(options) },
    showLoading() {},
    hideLoading() {},
    showToast(options) { calls.toast.push(options) },
    showModal() {},
    saveImageToPhotosAlbum(options) {
      calls.saved.push(options.filePath)
      options.success()
    }
  }
  let qrCalls = 0
  const getQrCode = async id => {
    qrCalls += 1
    return {
      ready: true,
      path: `/user/archive-code-${id}.jpg`,
      fileId: `cloud://test/codes/${id}.jpg`,
      id,
      name: '白牡丹',
      cacheStatus: 'hit',
      hint: ''
    }
  }
  const definition = evaluatePage(
    'pages/qrcode/qrcode.js',
    ['getQrCode', 'wx'],
    [getQrCode, wx]
  )
  const page = instantiate(definition)
  await page.onLoad({ id: 'archive01' })
  assert.equal(page.data.available, true)
  assert.equal(page.data.qr.ready, true)
  assert.equal(page.data.name, '白牡丹')
  assert.equal(page.data.qr.cacheStatus, 'hit')
  assert.equal(qrCalls, 1)

  page.onPreviewTap()
  assert.equal(calls.navigate.at(-1).url, '/pages/archive/archive?id=archive01')

  await page.onSaveTap()
  assert.equal(qrCalls, 1, 'saving must reuse the local qr-code image')
  assert.equal(calls.saved.at(-1), '/user/archive-code-archive01.jpg')
  assert.equal(calls.toast.at(-1).title, '已保存到相册')
  assert.equal(page.data.savingImage, false)
}

async function run() {
  const schema = evaluateSchema()
  await runEditTests(schema)
  await runArchiveTests(schema)
  await runHomeAndHistoryTests()
  await runQrCodeTests()
  console.log('passed: editor/archive, home/history, and qr-code flows')
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
