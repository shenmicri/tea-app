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
  return new Function(
    'SECTIONS',
    'createEmptySections',
    'findMissingRequired',
    'wx',
    `${source}\nreturn { listArchives, getArchive, saveArchive, copyArchive, deleteArchive }`
  )(schema.SECTIONS, schema.createEmptySections, schema.findMissingRequired, wx)
}

function completeSections(schema) {
  const sections = schema.createEmptySections()
  sections.basic.name = '白牡丹'
  sections.basic.category = '白茶'
  sections.basic.coverImage = 'wxfile://cover.jpg'
  sections.basic.summary = '柔雅花香，清甜如初春。'
  return sections
}

async function run() {
  const schema = evaluateSchema()
  const storage = {}
  const wx = {
    getStorageSync(key) {
      return storage[key]
    },
    setStorageSync(key, value) {
      storage[key] = value
    }
  }
  const store = evaluateStore(schema, wx)

  assert.deepEqual(
    schema.findMissingRequired(schema.createEmptySections()),
    ['茶名', '茶类', '档案主视觉', '产品简介']
  )

  const draft = await store.saveArchive({
    status: 'draft',
    sections: schema.createEmptySections()
  })
  assert.equal(draft.status, 'draft')
  assert.equal(storage.tea_archives[0].status, 'draft')

  const rejectedPublish = await store.saveArchive({
    status: 'published',
    sections: schema.createEmptySections()
  })
  assert.equal(rejectedPublish.status, 'draft')
  assert.equal(storage.tea_archives.find(item => item.id === rejectedPublish.id).status, 'draft')

  const sections = completeSections(schema)
  sections.feature.profile = '芽叶连枝，银毫披覆。'
  sections.feature.media = [{
    id: 'media-one',
    type: 'image',
    path: 'wxfile://detail.jpg',
    poster: '',
    duration: 0
  }]
  const published = await store.saveArchive({ status: 'published', sections })
  assert.equal(published.status, 'published')
  assert.equal((await store.getArchive(published.id)).status, 'published')

  const copied = await store.copyArchive(published.id)
  assert.equal(copied.status, 'draft')
  assert.notEqual(copied.id, published.id)
  assert.equal(copied.sections.basic.name, '白牡丹（副本）')
  assert.deepEqual(copied.sections.feature.media, published.sections.feature.media)
  assert.notEqual(copied.sections.feature.media, published.sections.feature.media)

  const legacySections = completeSections(schema)
  delete legacySections.feature.media
  legacySections.feature.images = ['wxfile://legacy.jpg']
  storage.tea_archives.push({
    id: 'legacyv2',
    name: '白牡丹',
    schemaVersion: 2,
    createdAt: 1,
    updatedAt: 2,
    sections: legacySections,
    customSections: []
  })
  const migrated = await store.getArchive('legacyv2')
  assert.equal(migrated.status, 'published')
  assert.deepEqual(migrated.sections.feature.media.map(item => item.path), ['wxfile://legacy.jpg'])

  const mixedSections = completeSections(schema)
  mixedSections.origin.media = [{ id: 'new-one', type: 'image', path: 'wxfile://new.jpg' }]
  mixedSections.origin.images = ['wxfile://old.jpg', 'wxfile://new.jpg']
  storage.tea_archives.push({
    id: 'mixedv2',
    name: '白牡丹',
    schemaVersion: 2,
    createdAt: 1,
    updatedAt: 2,
    sections: mixedSections,
    customSections: []
  })
  const mixed = await store.getArchive('mixedv2')
  assert.deepEqual(
    mixed.sections.origin.media.map(item => item.path),
    ['wxfile://new.jpg', 'wxfile://old.jpg']
  )

  storage.tea_archives.push({
    id: 'unknown-status',
    name: '白牡丹',
    schemaVersion: 3,
    status: 'publised',
    createdAt: 1,
    updatedAt: 2,
    sections: completeSections(schema),
    customSections: []
  })
  assert.equal((await store.getArchive('unknown-status')).status, 'draft')

  const iconPaths = schema.SECTIONS.flatMap(section => [
    section.icon,
    ...section.fields.map(field => field.icon)
  ]).filter(Boolean)
  assert.equal(new Set(iconPaths).size, iconPaths.length)
  iconPaths.forEach(iconPath => {
    assert.equal(fs.existsSync(path.join(process.cwd(), iconPath.replace(/^\//, ''))), true)
  })

  console.log(`passed: store, migration, publishing, copy, and ${iconPaths.length} unique icons`)
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
