const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function evaluateSchema() {
  const source = fs.readFileSync(path.join(process.cwd(), 'config/schema.js'), 'utf8')
    .replace(/export const /g, 'const ')
    .replace(/export function /g, 'function ')
  return new Function(`${source}\nreturn { SECTIONS, createEmptySections, findMissingRequired }`)()
}

function evaluateStore(schema, wx) {
  const source = fs.readFileSync(path.join(process.cwd(), 'utils/store.js'), 'utf8')
    .replace(/^import .*$/m, '')
    .replace(/export async function /g, 'async function ')
    .replace(/export const __test__ =/g, 'const __test__ =')
  return new Function(
    'createEmptySections',
    'findMissingRequired',
    'wx',
    `${source}\nreturn { listArchives, getArchive, getPublicArchive, recordArchiveView, listViewHistory, startArchiveDraft, saveArchive, copyArchive, deleteArchive, __test__ }`
  )(schema.createEmptySections, schema.findMissingRequired, wx)
}

function completeSections(schema) {
  const sections = schema.createEmptySections()
  sections.basic.name = '白牡丹'
  sections.basic.category = '白茶'
  sections.basic.coverImage = 'cloud://env/covers/cover.jpg'
  sections.basic.summary = '柔雅花香，清甜如初春。'
  sections.feature.profile = '芽叶连枝，银毫披覆。'
  sections.feature.media = [{
    id: 'media-one',
    type: 'image',
    path: 'cloud://env/images/detail.jpg',
    poster: '',
    duration: 0
  }]
  return sections
}

function response(data) {
  return Promise.resolve({ result: { ok: true, data } })
}

async function run() {
  const schema = evaluateSchema()
  const calls = []
  const root = {
    _id: 'archive1',
    status: 'published',
    schema_version: 3,
    tea_name: '白牡丹',
    tea_type: '白茶',
    cover_image_file_id: 'cloud://env/covers/cover.jpg',
    product_summary: '柔雅花香，清甜如初春。',
    tea_profile: '芽叶连枝，银毫披覆。',
    created_at: new Date('2026-08-12T10:00:00Z'),
    updated_at: new Date('2026-08-12T11:00:00Z')
  }
  const media = [{
    media_id: 'media-one',
    section_key: 'feature',
    media_type: 'image',
    file_id: 'cloud://env/images/detail.jpg',
    poster_file_id: '',
    duration_seconds: 0,
    sort_order: 1
  }]
  const custom = [{
    custom_item_id: 'custom-one',
    title: '获奖记录',
    content: '2026年春季茶会金奖',
    sort_order: 1
  }]

  const wx = {
    cloud: {
      callFunction(options) {
        calls.push(options)
        switch (options.data.action) {
          case 'listMine':
            return response([root])
          case 'getForEdit':
          case 'getPublicArchive':
          case 'save':
          case 'copy':
            return response({ root, media, custom_items: custom })
          case 'recordView':
            return response({ archive_id: options.data.id })
          case 'listHistory':
            return response([{
              archive_id: 'archive1',
              tea_name: '白牡丹',
              tea_type: '白茶',
              last_viewed_at: new Date('2026-08-12T12:00:00Z')
            }])
          case 'startDraft':
            return response({ id: 'reserved1', upload_token: 'archive-upload-token', revision: 0 })
          case 'delete':
            return response({ id: options.data.id })
          default:
            return Promise.resolve({ result: { ok: false, error: { code: 'UNKNOWN', message: 'bad action' } } })
        }
      }
    }
  }
  const store = evaluateStore(schema, wx)

  const composite = store.__test__.archiveToComposite({
    status: 'published',
    sections: completeSections(schema),
    customSections: [{ id: 'custom-one', title: '获奖记录', content: '2026年春季茶会金奖' }]
  })
  assert.equal(composite.status, 'published')
  assert.equal(composite.root.tea_name, '白牡丹')
  assert.equal(composite.media[0].section_key, 'feature')
  assert.equal(composite.media[0].file_id, 'cloud://env/images/detail.jpg')
  assert.equal(composite.custom_items.length, 1)

  const mapped = store.__test__.compositeToArchive({ root, media, custom_items: custom })
  assert.equal(mapped.id, 'archive1')
  assert.equal(mapped.sections.basic.name, '白牡丹')
  assert.equal(mapped.sections.basic.coverImageFileId, 'cloud://env/covers/cover.jpg')
  assert.equal(mapped.sections.feature.media[0].path, 'cloud://env/images/detail.jpg')
  assert.equal(mapped.sections.feature.media[0].fileId, 'cloud://env/images/detail.jpg')
  assert.equal(mapped.customSections[0].title, '获奖记录')

  assert.equal((await store.listArchives()).length, 1)
  assert.equal((await store.getArchive('archive1')).id, 'archive1')
  assert.equal((await store.getPublicArchive('archive1')).status, 'published')
  assert.equal((await store.recordArchiveView('archive1')).archive_id, 'archive1')
  const history = await store.listViewHistory()
  assert.deepEqual(history.map(item => item.id), ['archive1'])
  assert.equal(history[0].name, '白牡丹')
  assert.equal(history[0].category, '白茶')
  assert.equal(history[0].lastViewedAt, Date.parse('2026-08-12T12:00:00Z'))
  assert.equal(Object.hasOwn(history[0], 'coverImage'), false)
  assert.equal((await store.startArchiveDraft()).id, 'reserved1')
  assert.equal((await store.saveArchive({ status: 'published', sections: completeSections(schema), customSections: [] })).id, 'archive1')
  assert.equal((await store.copyArchive('archive1')).id, 'archive1')
  assert.equal((await store.deleteArchive('archive1')).id, 'archive1')

  assert.deepEqual(
    calls.map(call => call.data.action),
    ['listMine', 'getForEdit', 'getPublicArchive', 'recordView', 'listHistory', 'startDraft', 'save', 'copy', 'delete']
  )

  assert.throws(() => store.__test__.archiveToComposite({
    status: 'draft',
    sections: schema.createEmptySections(),
    customSections: Array.from({ length: 21 }, (_, index) => ({ id: `c${index}`, title: '', content: '' }))
  }), /最多只能添加20个/)

  assert.throws(() => store.__test__.archiveToComposite({
    status: 'published',
    sections: schema.createEmptySections(),
    customSections: []
  }), /请先补齐/)

  const iconPaths = schema.SECTIONS.flatMap(section => [
    section.icon,
    ...section.fields.map(field => field.icon)
  ]).filter(Boolean)
  assert.equal(new Set(iconPaths).size, iconPaths.length)
  iconPaths.forEach(iconPath => {
    assert.equal(fs.existsSync(path.join(process.cwd(), iconPath.replace(/^\//, ''))), true)
  })

  console.log(`passed: cloud store mappings, nine service actions, history fields, max-20 rule, and ${iconPaths.length} unique icons`)
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
