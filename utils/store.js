/**
 * 数据层。页面只通过这里读写数据。
 * 现阶段用 wx.*StorageSync 当数据库；将来换成云数据库时只改本文件，页面代码不动。
 * 因此所有导出函数都写成 async，尽管现在内部是同步的。
 */

import { SECTIONS, createEmptySections, findMissingRequired } from '../config/schema'

const STORAGE_KEY = 'tea_archives'
const CURRENT_SCHEMA_VERSION = 3

// 8 位短 id 的字符集：小写字母 + 数字，去掉容易混淆的 0 / o / 1 / l。
// 用短 id 是因为小程序码 scene 参数上限 32 字符，装不下完整 UUID。
const ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'
const ID_LENGTH = 8

function randomId() {
  let id = ''
  for (let i = 0; i < ID_LENGTH; i++) {
    id += ID_ALPHABET.charAt(Math.floor(Math.random() * ID_ALPHABET.length))
  }
  return id
}

// TODO: 接入云数据库后，读写换成 db.collection('archives') 的查询，下面两个函数一并删除。
function readAll() {
  const raw = wx.getStorageSync(STORAGE_KEY)
  return Array.isArray(raw) ? raw : []
}

function writeAll(list) {
  wx.setStorageSync(STORAGE_KEY, list)
}

function joinValues(items) {
  return items
    .filter(item => item.value && String(item.value).trim())
    .map(item => `${item.label}：${String(item.value).trim()}`)
    .join('\n')
}

function mergeImages(...lists) {
  return Array.from(new Set([].concat(...lists.filter(Array.isArray))))
}

function normalizeMedia(items) {
  if (!Array.isArray(items)) return []
  return items
    .map((item, index) => {
      if (typeof item === 'string') {
        return {
          id: `legacy-image-${index}`,
          type: 'image',
          path: item,
          poster: '',
          duration: 0
        }
      }
      if (!item || !item.path) return null
      return {
        id: item.id || `legacy-media-${index}`,
        type: item.type === 'video' ? 'video' : 'image',
        path: item.path,
        poster: item.poster || '',
        duration: Number(item.duration) || 0
      }
    })
    .filter(Boolean)
}

function mergeMedia(...lists) {
  const seen = new Set()
  return normalizeMedia([].concat(...lists.filter(Array.isArray))).filter(item => {
    const key = `${item.type}:${item.path}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** 把旧版字段逐级迁移到当前结构，避免测试数据因 schema 调整而丢失。 */
function migrateSections(archive) {
  const source = archive.sections || {}
  const version = archive.schemaVersion || 1
  let migrated = source

  if (version < 2) {
    const basic = source.basic || {}
    const feature = source.feature || {}
    const origin = source.origin || {}
    const culture = source.culture || {}
    const brand = source.brand || {}

    migrated = {
      ...source,
      basic: {
        ...basic,
        summary: joinValues([
          { label: '具体品种或小类', value: basic.variety },
          { label: '介绍', value: basic.summary }
        ])
      },
      feature: {
        ...feature,
        profile: joinValues([
          { label: '干茶外形', value: feature.appearance },
          { label: '香气', value: feature.aroma },
          { label: '汤色', value: feature.liquor },
          { label: '滋味', value: feature.taste },
          { label: '叶底', value: feature.leaf }
        ]),
        usage: joinValues([
          { label: '冲泡建议', value: feature.brewing },
          { label: '储存方式', value: feature.storage },
          { label: '注意事项', value: feature.caution }
        ])
      },
      origin: {
        ...origin,
        place: joinValues([
          { label: '产地', value: origin.region },
          { label: '茶区／山场／茶园', value: origin.garden },
          { label: '生长环境', value: origin.environment }
        ]),
        rawMaterial: joinValues([
          { label: '茶树品种', value: origin.cultivar },
          { label: '树龄', value: origin.treeAge }
        ]),
        harvest: joinValues([
          { label: '种植方式', value: origin.planting },
          { label: '采摘时间或季节', value: origin.pickingTime },
          { label: '采摘标准', value: origin.pickingStandard }
        ])
      },
      brand: {
        ...brand,
        story: joinValues([
          { label: '历史与文化背景', value: culture.history },
          { label: '传统故事', value: culture.legend },
          { label: '茶园或制茶人故事', value: culture.makerStory },
          { label: '生产者介绍', value: brand.producer }
        ]),
        contactInfo: joinValues([
          { label: '联系方式', value: brand.contact },
          { label: '地址', value: brand.address },
          { label: '官方网站', value: brand.website }
        ]),
        images: mergeImages(brand.images, culture.images)
      }
    }
  }

  if (version < 3) {
    migrated = { ...migrated }
    SECTIONS.filter(section => section.key !== 'basic').forEach(section => {
      const oldSection = migrated[section.key] || {}
      migrated[section.key] = {
        ...oldSection,
        media: mergeMedia(oldSection.media, oldSection.images)
      }
    })
  }

  return migrated
}

/**
 * 用当前 schema 补齐一份档案：schema 里新增的字段补空值，旧数据里多余的键原样保留但不渲染。
 * 有了它，schema 改动后老档案也能正常打开。
 */
function applySchema(archive) {
  if (!archive) return null
  const sections = migrateSections(archive)
  const filled = createEmptySections()
  SECTIONS.forEach(section => {
    const saved = sections[section.key] || {}
    Object.keys(saved).forEach(key => {
      if (saved[key] !== undefined && saved[key] !== null) filled[section.key][key] = saved[key]
    })
  })
  const complete = findMissingRequired(filled).length === 0
  const legacyPublished = archive.status === undefined && (archive.schemaVersion || 1) < 3 && complete
  return {
    id: archive.id,
    name: archive.name || '',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    status: (archive.status === 'published' && complete) || legacyPublished ? 'published' : 'draft',
    createdAt: archive.createdAt || 0,
    updatedAt: archive.updatedAt || 0,
    sections: filled,
    customSections: Array.isArray(archive.customSections) ? archive.customSections : []
  }
}

/** 全部档案，按更新时间倒序。 */
export async function listArchives() {
  return readAll()
    .map(applySchema)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
}

/** 按 id 取一份，取不到返回 null。 */
export async function getArchive(id) {
  const found = readAll().find(item => item.id === id)
  return applySchema(found)
}

/** 新建或更新。无 id 则新建并生成 8 位短 id。返回保存后的完整档案。 */
export async function saveArchive(data) {
  const list = readAll()
  const now = Date.now()
  const sections = data.sections || createEmptySections()
  const status = data.status === 'published' && findMissingRequired(sections).length === 0
    ? 'published'
    : 'draft'
  // 茶名冗余存一份，列表页不必展开 sections 就能显示。
  const name = ((sections.basic || {}).name || '').trim()

  let id = data.id
  let createdAt = data.createdAt || now
  if (id) {
    const index = list.findIndex(item => item.id === id)
    if (index >= 0) createdAt = list[index].createdAt || now
  } else {
    do {
      id = randomId()
    } while (list.some(item => item.id === id))
  }

  const record = {
    id,
    name,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    status,
    createdAt,
    updatedAt: now,
    sections,
    customSections: Array.isArray(data.customSections) ? data.customSections : []
  }

  const index = list.findIndex(item => item.id === id)
  if (index >= 0) list[index] = record
  else list.push(record)

  writeAll(list)
  return applySchema(record)
}

/** 复制一份档案并生成新的短 id；原档案保持不变。 */
export async function copyArchive(id) {
  const source = await getArchive(id)
  if (!source) return null

  const sections = JSON.parse(JSON.stringify(source.sections))
  const customSections = JSON.parse(JSON.stringify(source.customSections))
  const originalName = ((sections.basic || {}).name || '').trim()
  sections.basic.name = `${originalName || '未命名'}（副本）`

  return saveArchive({
    id: '',
    createdAt: 0,
    status: 'draft',
    sections,
    customSections
  })
}

/** 按 id 删除。 */
export async function deleteArchive(id) {
  writeAll(readAll().filter(item => item.id !== id))
}
