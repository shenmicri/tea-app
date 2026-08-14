/**
 * 云数据层。
 *
 * 页面继续使用 listArchives / getArchive / saveArchive 等稳定接口；真正的数据由
 * archiveService 云函数在 tea_archives、archive_media、archive_custom_items、
 * archive_view_history 四个 Collection 之间同步。客户端不直接读写 Collection，避免草稿泄露和跨表
 * 更新只完成一半。
 */

import { createEmptySections, findMissingRequired } from '../config/schema'

const CLOUD_FUNCTION_NAME = 'archiveService'
const CURRENT_SCHEMA_VERSION = 3

function toTimestamp(value) {
  if (!value) return 0
  if (typeof value === 'number') return value
  if (value instanceof Date) return value.getTime()
  if (value.$date) return Number(value.$date) || 0
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? 0 : parsed
}

function cleanText(value) {
  return value === undefined || value === null ? '' : String(value)
}

function callArchiveService(action, data = {}) {
  return wx.cloud.callFunction({
    name: CLOUD_FUNCTION_NAME,
    data: { action, ...data }
  }).then(response => {
    const result = response && response.result
    if (!result || result.ok !== true) {
      const remote = result && result.error
      const error = new Error((remote && remote.message) || '云数据库暂时不可用，请稍后重试')
      error.code = (remote && remote.code) || 'CLOUD_SERVICE_ERROR'
      throw error
    }
    return result.data
  })
}

function makeMediaRow(sectionKey, item, index) {
  return {
    media_id: item.id || `media_${sectionKey}_${index + 1}`,
    section_key: sectionKey,
    media_type: item.type === 'video' ? 'video' : 'image',
    file_id: item.fileId || item.path || '',
    poster_file_id: item.posterFileId || item.poster || '',
    duration_seconds: Math.max(0, Number(item.duration) || 0),
    sort_order: index + 1
  }
}

function archiveToComposite(data) {
  const sections = data.sections || createEmptySections()
  const basic = sections.basic || {}
  const feature = sections.feature || {}
  const origin = sections.origin || {}
  const brand = sections.brand || {}
  const customSections = Array.isArray(data.customSections) ? data.customSections : []

  if (customSections.length > 20) {
    const error = new Error('每份档案最多只能添加20个自定义项目')
    error.code = 'CUSTOM_LIMIT'
    throw error
  }

  const wantsPublish = data.status === 'published'
  const missingRequired = findMissingRequired(sections)
  if (wantsPublish && missingRequired.length > 0) {
    const error = new Error(`请先补齐：${missingRequired.join('、')}`)
    error.code = 'PUBLISH_REQUIRED'
    throw error
  }
  const status = wantsPublish ? 'published' : 'draft'

  return {
    id: data.id || '',
    revision: Math.max(0, Number(data.revision) || 0),
    upload_token: data.uploadToken || data.id || '',
    status,
    root: {
      tea_name: cleanText(basic.name).trim(),
      tea_type: cleanText(basic.category).trim(),
      cover_image_file_id: cleanText(basic.coverImageFileId || basic.coverImage).trim(),
      product_summary: cleanText(basic.summary).trim(),
      product_code: cleanText(basic.code).trim(),
      tea_profile: cleanText(feature.profile).trim(),
      processing_craft: cleanText(feature.craft).trim(),
      brewing_storage_notes: cleanText(feature.usage).trim(),
      origin_environment: cleanText(origin.place).trim(),
      tea_plant_material: cleanText(origin.rawMaterial).trim(),
      planting_and_harvest: cleanText(origin.harvest).trim(),
      brand_name: cleanText(brand.brandName).trim(),
      brand_story: cleanText(brand.story).trim(),
      contact_info: cleanText(brand.contactInfo).trim()
    },
    media: [
      ...(Array.isArray(feature.media) ? feature.media.map((item, index) => makeMediaRow('feature', item, index)) : []),
      ...(Array.isArray(origin.media) ? origin.media.map((item, index) => makeMediaRow('origin', item, index)) : []),
      ...(Array.isArray(brand.media) ? brand.media.map((item, index) => makeMediaRow('brand', item, index)) : [])
    ],
    custom_items: customSections.map((item, index) => ({
      custom_item_id: item.id || `custom_${index + 1}`,
      title: cleanText(item.title).trim(),
      content: cleanText(item.content).trim(),
      sort_order: index + 1
    }))
  }
}

function addMediaToSections(sections, rows) {
  const ordered = (Array.isArray(rows) ? rows : [])
    .slice()
    .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0))

  ordered.forEach((row, index) => {
    const key = row.section_key
    if (!['feature', 'origin', 'brand'].includes(key)) return
    sections[key].media.push({
      id: row.media_id || `media_${key}_${index + 1}`,
      type: row.media_type === 'video' ? 'video' : 'image',
      path: row.preview_url || row.file_id || '',
      fileId: row.file_id || '',
      poster: row.poster_preview_url || row.poster_file_id || '',
      posterFileId: row.poster_file_id || '',
      duration: Math.max(0, Number(row.duration_seconds) || 0)
    })
  })
}

function compositeToArchive(composite) {
  if (!composite) return null
  const root = composite.root || composite
  if (!root || !root._id) return null

  const sections = createEmptySections()
  sections.basic = {
    name: root.tea_name || '',
    category: root.tea_type || '',
    coverImage: root.cover_image_preview_url || root.cover_image_file_id || '',
    coverImageFileId: root.cover_image_file_id || '',
    summary: root.product_summary || '',
    code: root.product_code || ''
  }
  sections.feature = {
    profile: root.tea_profile || '',
    craft: root.processing_craft || '',
    usage: root.brewing_storage_notes || '',
    media: []
  }
  sections.origin = {
    place: root.origin_environment || '',
    rawMaterial: root.tea_plant_material || '',
    harvest: root.planting_and_harvest || '',
    media: []
  }
  sections.brand = {
    brandName: root.brand_name || '',
    story: root.brand_story || '',
    contactInfo: root.contact_info || '',
    media: []
  }

  addMediaToSections(sections, composite.media)

  const customSections = (Array.isArray(composite.custom_items) ? composite.custom_items : [])
    .slice()
    .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0))
    .slice(0, 20)
    .map((item, index) => ({
      id: item.custom_item_id || `custom_${index + 1}`,
      title: item.title || '',
      content: item.content || ''
    }))

  return {
    id: root._id,
    name: root.tea_name || '',
    schemaVersion: Number(root.schema_version) || CURRENT_SCHEMA_VERSION,
    revision: Math.max(0, Number(root.revision) || 0),
    uploadToken: root.upload_token || root._id,
    status: root.status === 'published' ? 'published' : 'draft',
    publicStatus: root.public_status === 'published' || root.status === 'published'
      ? 'published'
      : 'none',
    createdAt: toTimestamp(root.created_at),
    updatedAt: toTimestamp(root.updated_at),
    publishedAt: toTimestamp(root.published_at),
    sections,
    customSections
  }
}

/** 当前用户创建的全部档案，按更新时间倒序。 */
export async function listArchives() {
  const rows = await callArchiveService('listMine')
  return (Array.isArray(rows) ? rows : [])
    .map(root => compositeToArchive({ root, media: [], custom_items: [] }))
    .filter(Boolean)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
}

/** 卖家编辑读取。只能读取当前用户自己的档案，包括草稿。 */
export async function getArchive(id) {
  if (!id) return null
  try {
    return compositeToArchive(await callArchiveService('getForEdit', { id }))
  } catch (error) {
    if (error.code === 'NOT_FOUND') return null
    throw error
  }
}

/** 消费者读取。云函数只会返回已经生成的档案。 */
export async function getPublicArchive(id) {
  if (!id) return null
  try {
    return compositeToArchive(await callArchiveService('getPublicArchive', { id }))
  } catch (error) {
    if (error.code === 'NOT_FOUND') return null
    throw error
  }
}

/** 消费者成功打开公开档案后记录访问；同一用户与档案只保留一条历史记录。 */
export async function recordArchiveView(id) {
  if (!id) return null
  return callArchiveService('recordView', { id })
}

/** 当前用户看过的仍可访问档案，按最近查看时间倒序。 */
export async function listViewHistory() {
  const rows = await callArchiveService('listHistory')
  return (Array.isArray(rows) ? rows : []).map(row => ({
    id: row.archive_id || '',
    name: row.tea_name || '',
    category: row.tea_type || '',
    lastViewedAt: toTimestamp(row.last_viewed_at)
  })).filter(item => item.id)
}

/** 为新档案签发逻辑 ID 与专属上传目录；首次保存前不会写入 tea_archives。 */
export async function startArchiveDraft() {
  const result = await callArchiveService('startDraft')
  return {
    id: result.id,
    revision: Math.max(0, Number(result.revision) || 0),
    uploadToken: result.upload_token || ''
  }
}

/** 保存草稿或生成档案。三张档案 Collection 由云函数统一同步。 */
export async function saveArchive(data) {
  const composite = archiveToComposite(data)
  return compositeToArchive(await callArchiveService('save', { archive: composite }))
}

/** 复制完整档案；新档案一定是草稿，媒体复用同一份云存储 fileID。 */
export async function copyArchive(id) {
  if (!id) return null
  try {
    return compositeToArchive(await callArchiveService('copy', { id }))
  } catch (error) {
    if (error.code === 'NOT_FOUND') return null
    throw error
  }
}

/** 删除档案并由云函数清理两张子 Collection；共享云文件不会被误删。 */
export async function deleteArchive(id) {
  if (!id) return null
  return callArchiveService('delete', { id })
}

// 供自动测试验证纯映射逻辑，不参与页面运行。
export const __test__ = {
  archiveToComposite,
  compositeToArchive
}
