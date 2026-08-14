const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const archives = db.collection('tea_archives')
const mediaCollection = db.collection('archive_media')
const customCollection = db.collection('archive_custom_items')
const historyCollection = db.collection('archive_view_history')

const CURRENT_SCHEMA_VERSION = 3
const PAGE_SIZE = 100
const ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'
const ID_LENGTH = 8
const SECTION_KEYS = ['feature', 'origin', 'brand']
const FILE_ID_PATTERN = /^cloud:\/\/([^/]+)\/(tea-archives\/([^/]+)\/.+)$/
const PUBLISHED_FILE_ID_PATTERN = /^cloud:\/\/([^/]+)\/(tea-archives-published\/.+)$/
const TEXT_CHECK_CHUNK_SIZE = 2000
const TEXT_CHECK_MAX_CHARACTERS = 40000
const IMAGE_CHECK_MAX_BYTES = 1024 * 1024
const IMAGE_CHECK_CONCURRENCY = 3
const MAX_PUBLISH_IMAGES = 30
const QR_CODE_VERSION = 1
const QR_CODE_PAGE = 'pages/archive/archive'
const TEXT_FIELDS = [
  ['tea_name', '茶名'],
  ['tea_type', '茶类'],
  ['product_summary', '产品简介'],
  ['product_code', '产品编号'],
  ['tea_profile', '茶叶特点'],
  ['processing_craft', '制作工艺'],
  ['brewing_storage_notes', '冲泡、使用与储存'],
  ['origin_environment', '产地与环境'],
  ['tea_plant_material', '茶树与原料'],
  ['planting_and_harvest', '种植与采摘'],
  ['brand_name', '品牌名称'],
  ['brand_story', '品牌故事'],
  ['contact_info', '联系信息']
]

function serviceError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function cleanText(value) {
  return value === undefined || value === null ? '' : String(value).trim()
}

function cleanOptionalText(value) {
  const text = cleanText(value)
  return text || ''
}

function randomId() {
  let id = ''
  for (let i = 0; i < ID_LENGTH; i += 1) {
    id += ID_ALPHABET.charAt(Math.floor(Math.random() * ID_ALPHABET.length))
  }
  return id
}

function childDocumentId(archiveId, kind, stableId) {
  const digest = crypto
    .createHash('sha1')
    .update(`${kind}:${stableId}`)
    .digest('hex')
    .slice(0, 16)
  return `${archiveId}_${kind.charAt(0)}_${digest}`
}

function archiveRecordId(archiveId, recordType) {
  return `${archiveId}_${recordType}`
}

function logicalArchiveId(record) {
  if (!record) return ''
  return cleanText(record.archive_id || record._id).replace(/_(?:draft|published)$/, '')
}

function ownerUploadToken(openid, archiveId) {
  const ownerHash = crypto.createHash('sha256').update(openid).digest('hex').slice(0, 20)
  return `a_${archiveId}_${ownerHash}`
}

function historyDocumentId(openid, archiveId) {
  const digest = crypto
    .createHash('sha256')
    .update(`${openid}:${archiveId}`)
    .digest('hex')
    .slice(0, 32)
  return `history_${digest}`
}

function publicationId() {
  return `p_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`
}

function timestampValue(value) {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (value.$date) return Number(value.$date) || 0
  const result = new Date(value).getTime()
  return Number.isNaN(result) ? 0 : result
}

function uniqueStableId(rawValue, fallback, seenIds) {
  const base = (cleanText(rawValue) || fallback).slice(0, 80)
  let candidate = base
  let suffix = 1
  while (seenIds.has(candidate)) {
    suffix += 1
    const marker = `_${suffix}`
    candidate = `${base.slice(0, 80 - marker.length)}${marker}`
  }
  seenIds.add(candidate)
  return candidate
}

function normalizeRoot(input = {}) {
  return {
    tea_name: cleanOptionalText(input.tea_name),
    tea_type: cleanOptionalText(input.tea_type),
    cover_image_file_id: cleanOptionalText(input.cover_image_file_id),
    product_summary: cleanOptionalText(input.product_summary),
    product_code: cleanOptionalText(input.product_code),
    tea_profile: cleanOptionalText(input.tea_profile),
    processing_craft: cleanOptionalText(input.processing_craft),
    brewing_storage_notes: cleanOptionalText(input.brewing_storage_notes),
    origin_environment: cleanOptionalText(input.origin_environment),
    tea_plant_material: cleanOptionalText(input.tea_plant_material),
    planting_and_harvest: cleanOptionalText(input.planting_and_harvest),
    brand_name: cleanOptionalText(input.brand_name),
    brand_story: cleanOptionalText(input.brand_story),
    contact_info: cleanOptionalText(input.contact_info)
  }
}

function normalizeMedia(input = []) {
  if (!Array.isArray(input)) return []
  const seenIds = new Set()
  return input
    .map((item, index) => {
      const sectionKey = cleanText(item.section_key)
      const fileId = cleanText(item.file_id)
      if (!SECTION_KEYS.includes(sectionKey) || !fileId) return null

      const mediaId = uniqueStableId(item.media_id, `media_${index + 1}`, seenIds)

      return {
        media_id: mediaId,
        section_key: sectionKey,
        media_type: item.media_type === 'video' ? 'video' : 'image',
        file_id: fileId,
        poster_file_id: cleanOptionalText(item.poster_file_id),
        duration_seconds: Math.max(0, Number(item.duration_seconds) || 0),
        sort_order: Math.max(1, Number(item.sort_order) || index + 1)
      }
    })
    .filter(Boolean)
}

function normalizeCustomItems(input = [], publishing = false) {
  if (!Array.isArray(input)) return []
  const seenIds = new Set()
  const effective = input
    .map((item, index) => {
      const itemId = uniqueStableId(item.custom_item_id, `custom_${index + 1}`, seenIds)
      return {
        custom_item_id: itemId,
        title: cleanOptionalText(item.title),
        content: cleanOptionalText(item.content),
        sort_order: index + 1
      }
    })
    .filter(item => item.title || item.content)

  if (effective.length > 20) {
    throw serviceError('CUSTOM_LIMIT', '每份档案最多只能添加20个自定义项目')
  }

  if (publishing) {
    const invalid = effective.find(item => item.content && !item.title)
    if (invalid) {
      throw serviceError('CUSTOM_TITLE_REQUIRED', '有内容的自定义项目必须填写标题')
    }
  }

  return effective
}

function validatePublish(root) {
  const missing = []
  if (!root.tea_name) missing.push('茶名')
  if (!root.tea_type) missing.push('茶类')
  if (!root.cover_image_file_id) missing.push('档案主视觉')
  if (!root.product_summary) missing.push('产品简介')
  if (missing.length) {
    throw serviceError('PUBLISH_REQUIRED', `请先补齐：${missing.join('、')}`)
  }
}

function numericSecurityCode(value) {
  if (!value) return NaN
  const nested = value.result && typeof value.result === 'object' ? value.result : null
  const deep = nested && nested.result && typeof nested.result === 'object'
    ? nested.result
    : null
  const candidates = [
    deep && deep.errCode,
    deep && deep.errcode,
    nested && nested.errCode,
    nested && nested.errcode,
    value.errCode,
    value.errcode,
    value.code
  ]
  for (const raw of candidates) {
    if (raw === undefined || raw === null || raw === '') continue
    const result = Number(raw)
    if (Number.isFinite(result)) return result
  }
  return NaN
}

function securityTextResult(response) {
  if (!response || typeof response !== 'object') return null
  if (response.result && typeof response.result.suggest === 'string') return response.result
  if (
    response.result &&
    response.result.result &&
    typeof response.result.result.suggest === 'string'
  ) {
    return response.result.result
  }
  return null
}

function securityImagePayload(response) {
  if (
    response &&
    response.result &&
    typeof response.result === 'object' &&
    (response.result.errCode !== undefined || response.result.errcode !== undefined)
  ) {
    return response.result
  }
  return response
}

function publishTextChunks(root, customItems) {
  const parts = []
  TEXT_FIELDS.forEach(([key, label]) => {
    const value = cleanText(root[key])
    if (value) parts.push(`${label}：${value}`)
  })
  customItems.forEach((item, index) => {
    if (item.title) parts.push(`自定义项目${index + 1}标题：${item.title}`)
    if (item.content) parts.push(`自定义项目${index + 1}内容：${item.content}`)
  })

  const characters = Array.from(parts.join('\n'))
  if (characters.length > TEXT_CHECK_MAX_CHARACTERS) {
    throw serviceError(
      'CONTENT_TOO_LONG',
      '档案文字内容过长，暂时无法完成安全检测，请适当精简后重试'
    )
  }

  const chunks = []
  for (let start = 0; start < characters.length; start += TEXT_CHECK_CHUNK_SIZE) {
    chunks.push(characters.slice(start, start + TEXT_CHECK_CHUNK_SIZE).join(''))
  }
  // msgSecCheck 的 content 为必填字段；固定必填项确保发布时通常不会为空，
  // 这里仍保留兜底，避免未来字段规则变化后提交空 content。
  return chunks.length ? chunks : ['茶叶档案']
}

async function validateTextSafety(root, customItems, openid) {
  const chunks = publishTextChunks(root, customItems)
  for (const content of chunks) {
    let response
    try {
      response = await cloud.openapi.security.msgSecCheck({
        content,
        version: 2,
        scene: 1,
        openid
      })
    } catch (error) {
      if (numericSecurityCode(error) === 87014) {
        throw serviceError('TEXT_CONTENT_RISKY', '档案文字未通过安全检测，请检查并修改后重试')
      }
      throw serviceError('CONTENT_CHECK_UNAVAILABLE', '文字安全检测服务暂时不可用，请稍后重试')
    }

    const errorCode = numericSecurityCode(response)
    const result = securityTextResult(response)
    if (errorCode === 87014) {
      throw serviceError('TEXT_CONTENT_RISKY', '档案文字未通过安全检测，请检查并修改后重试')
    }
    if (errorCode !== 0 || !result) {
      throw serviceError('CONTENT_CHECK_UNAVAILABLE', '文字安全检测服务暂时不可用，请稍后重试')
    }
    if (result.suggest !== 'pass') {
      throw serviceError('TEXT_CONTENT_RISKY', '档案文字未通过安全检测，请检查并修改后重试')
    }
  }
}

function imageContentType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return 'image/png'
  }
  if (buffer.length >= 6) {
    const signature = buffer.subarray(0, 6).toString('ascii')
    if (signature === 'GIF87a' || signature === 'GIF89a') return 'image/gif'
  }
  return ''
}

function readUInt32BigEndian(buffer, offset) {
  if (offset < 0 || offset + 4 > buffer.length) return 0
  return buffer.readUInt32BE(offset)
}

function gifDimensions(buffer) {
  if (buffer.length < 10) return null
  return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) }
}

function pngDimensions(buffer) {
  if (buffer.length < 24 || buffer.subarray(12, 16).toString('ascii') !== 'IHDR') return null
  return { width: readUInt32BigEndian(buffer, 16), height: readUInt32BigEndian(buffer, 20) }
}

function jpegDimensions(buffer) {
  let offset = 2
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = buffer[offset + 1]
    offset += 2
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) continue
    if (marker >= 0xd0 && marker <= 0xd7) continue
    if (offset + 2 > buffer.length) break
    const length = buffer.readUInt16BE(offset)
    if (length < 2 || offset + length > buffer.length) break
    const isStartOfFrame = (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    )
    if (isStartOfFrame && length >= 7) {
      return {
        width: buffer.readUInt16BE(offset + 5),
        height: buffer.readUInt16BE(offset + 3)
      }
    }
    offset += length
  }
  return null
}

function imageDimensions(buffer, contentType) {
  if (contentType === 'image/png') return pngDimensions(buffer)
  if (contentType === 'image/gif') return gifDimensions(buffer)
  if (contentType === 'image/jpeg') return jpegDimensions(buffer)
  return null
}

function publishImageFileIds(root, media) {
  const fileIds = [root.cover_image_file_id]
  media.forEach(item => {
    if (item.media_type === 'image') {
      fileIds.push(item.file_id)
    }
  })
  const uniqueFileIds = Array.from(new Set(fileIds.filter(Boolean)))
  if (uniqueFileIds.length > MAX_PUBLISH_IMAGES) {
    throw serviceError(
      'PUBLISH_IMAGE_LIMIT',
      `每份档案最多可发布 ${MAX_PUBLISH_IMAGES} 张图片，请删除部分图片后重试`
    )
  }
  return uniqueFileIds
}

async function validateImageSafety(fileId) {
  let download
  try {
    download = await cloud.downloadFile({ fileID: fileId })
  } catch (error) {
    throw serviceError('CONTENT_CHECK_UNAVAILABLE', '图片读取失败，暂时无法完成安全检测，请稍后重试')
  }

  let buffer
  try {
    buffer = Buffer.isBuffer(download.fileContent)
      ? download.fileContent
      : Buffer.from(download.fileContent)
  } catch (error) {
    throw serviceError('CONTENT_CHECK_UNAVAILABLE', '图片读取失败，暂时无法完成安全检测，请稍后重试')
  }
  if (!buffer.length) {
    throw serviceError('CONTENT_CHECK_UNAVAILABLE', '图片读取失败，暂时无法完成安全检测，请重新上传')
  }
  if (buffer.length > IMAGE_CHECK_MAX_BYTES) {
    throw serviceError('IMAGE_TOO_LARGE', '有图片超过安全检测支持的大小，请压缩到 1MB 以内后重新上传')
  }
  const contentType = imageContentType(buffer)
  if (!contentType) {
    throw serviceError('IMAGE_FORMAT_UNSUPPORTED', '安全检测仅支持 JPG、PNG 或 GIF 图片，请更换图片后重试')
  }
  const dimensions = imageDimensions(buffer, contentType)
  if (dimensions && (dimensions.width > 750 || dimensions.height > 1334)) {
    throw serviceError(
      'IMAGE_DIMENSIONS_TOO_LARGE',
      '有图片尺寸超过安全检测支持的 750×1334，请压缩或裁剪后重新上传'
    )
  }

  let response
  try {
    response = await cloud.openapi.security.imgSecCheck({
      media: {
        contentType,
        value: buffer
      }
    })
  } catch (error) {
    if (numericSecurityCode(error) === 87014) {
      throw serviceError('IMAGE_CONTENT_RISKY', '有图片未通过安全检测，请检查并更换后重试')
    }
    const message = cleanText(error && (error.errMsg || error.errmsg || error.message))
    if (/size|1m|too large|exceed/i.test(message)) {
      throw serviceError('IMAGE_TOO_LARGE', '有图片超过安全检测支持的大小，请压缩到 1MB 以内后重新上传')
    }
    if (/width|height|dimension|750|1334/i.test(message)) {
      throw serviceError(
        'IMAGE_DIMENSIONS_TOO_LARGE',
        '有图片尺寸超过安全检测支持的 750×1334，请压缩或裁剪后重新上传'
      )
    }
    if (/format|content.?type|mime|png|jpe?g|gif/i.test(message)) {
      throw serviceError('IMAGE_FORMAT_UNSUPPORTED', '安全检测仅支持 JPG、PNG 或 GIF 图片，请更换图片后重试')
    }
    throw serviceError('CONTENT_CHECK_UNAVAILABLE', '图片安全检测服务暂时不可用，请稍后重试')
  }

  const errorCode = numericSecurityCode(response)
  if (errorCode === 87014) {
    throw serviceError('IMAGE_CONTENT_RISKY', '有图片未通过安全检测，请检查并更换后重试')
  }
  if (errorCode !== 0) {
    const payload = securityImagePayload(response)
    const message = cleanText(payload && (payload.errMsg || payload.errmsg))
    if (/size|1m|too large|exceed/i.test(message)) {
      throw serviceError('IMAGE_TOO_LARGE', '有图片超过安全检测支持的大小，请压缩到 1MB 以内后重新上传')
    }
    if (/width|height|dimension|750|1334/i.test(message)) {
      throw serviceError(
        'IMAGE_DIMENSIONS_TOO_LARGE',
        '有图片尺寸超过安全检测支持的 750×1334，请压缩或裁剪后重新上传'
      )
    }
    if (/format|content.?type|mime|png|jpe?g|gif/i.test(message)) {
      throw serviceError('IMAGE_FORMAT_UNSUPPORTED', '安全检测仅支持 JPG、PNG 或 GIF 图片，请更换图片后重试')
    }
    throw serviceError('CONTENT_CHECK_UNAVAILABLE', '图片安全检测服务暂时不可用，请稍后重试')
  }
  return { buffer, contentType }
}

async function runWithConcurrency(items, concurrency, callback) {
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      await callback(items[index], index)
    }
  })
  await Promise.all(workers)
}

function publishedAssetExtension(contentType) {
  if (contentType === 'image/png') return 'png'
  if (contentType === 'image/gif') return 'gif'
  return 'jpg'
}

function publishedAssetPath(openid, archiveId, publicationVersion, fileId, contentType) {
  const ownerHash = crypto.createHash('sha256').update(openid).digest('hex').slice(0, 20)
  const fileHash = crypto.createHash('sha256').update(fileId).digest('hex').slice(0, 32)
  return [
    'tea-archives-published',
    ownerHash,
    archiveId,
    publicationVersion,
    `${fileHash}.${publishedAssetExtension(contentType)}`
  ].join('/')
}

async function createPublishedImageCopy({
  openid,
  archiveId,
  publicationVersion,
  fileId,
  buffer,
  contentType
}) {
  let result
  try {
    result = await cloud.uploadFile({
      cloudPath: publishedAssetPath(openid, archiveId, publicationVersion, fileId, contentType),
      fileContent: buffer
    })
  } catch (error) {
    throw serviceError('PUBLISHED_MEDIA_COPY_FAILED', '图片发布副本创建失败，请稍后重试')
  }
  const publishedFileId = cleanText(result && (result.fileID || result.fileId))
  if (!PUBLISHED_FILE_ID_PATTERN.test(publishedFileId)) {
    throw serviceError('PUBLISHED_MEDIA_COPY_FAILED', '图片发布副本创建失败，请稍后重试')
  }
  return publishedFileId
}

async function removeCloudFiles(fileIds) {
  const uniqueIds = Array.from(new Set((fileIds || []).filter(Boolean)))
  for (let start = 0; start < uniqueIds.length; start += 50) {
    const batch = uniqueIds.slice(start, start + 50)
    const result = await cloud.deleteFile({ fileList: batch })
    const outcomes = result.fileList || []
    const failures = outcomes.filter(item => {
      if (item.status !== undefined) return Number(item.status) !== 0
      if (item.code !== undefined) return item.code !== 'SUCCESS' && item.code !== 0
      return false
    }).filter(item => !/not exist|not found|does not exist/i.test(
      cleanText(item.errMsg || item.message)
    ))
    if (outcomes.length !== batch.length || failures.length) {
      throw serviceError('PUBLISHED_MEDIA_CLEANUP_FAILED', '部分发布图片清理失败')
    }
  }
}

function publishedFileIdsFromVersion(snapshot, mediaRows) {
  const fileIds = []
  const cover = snapshot && snapshot.cover_image_file_id
  if (PUBLISHED_FILE_ID_PATTERN.test(cleanText(cover))) fileIds.push(cover)
  ;(mediaRows || []).forEach(item => {
    if (PUBLISHED_FILE_ID_PATTERN.test(cleanText(item.file_id))) fileIds.push(item.file_id)
    if (PUBLISHED_FILE_ID_PATTERN.test(cleanText(item.poster_file_id))) fileIds.push(item.poster_file_id)
  })
  return Array.from(new Set(fileIds))
}

async function preparePublishedContent(root, media, customItems, openid, archiveId, publicationVersion) {
  const imageFileIds = publishImageFileIds(root, media)
  await validateTextSafety(root, customItems, openid)
  const checkedImages = new Map()
  await runWithConcurrency(imageFileIds, IMAGE_CHECK_CONCURRENCY, async fileId => {
    checkedImages.set(fileId, await validateImageSafety(fileId))
  })

  const publishedFileIds = new Map()
  let copyError = null
  try {
    await runWithConcurrency(imageFileIds, IMAGE_CHECK_CONCURRENCY, async fileId => {
      const checked = checkedImages.get(fileId)
      try {
        const publishedFileId = await createPublishedImageCopy({
          openid,
          archiveId,
          publicationVersion,
          fileId,
          buffer: checked.buffer,
          contentType: checked.contentType
        })
        publishedFileIds.set(fileId, publishedFileId)
      } catch (error) {
        copyError = copyError || error
      }
    })
    if (copyError) throw copyError
  } catch (error) {
    try {
      await removeCloudFiles(Array.from(publishedFileIds.values()))
    } catch (cleanupError) {
      console.error('[archiveService] published media copy rollback', archiveId)
    }
    throw error
  }

  return {
    root: {
      ...root,
      cover_image_file_id: publishedFileIds.get(root.cover_image_file_id)
    },
    media: media.map(item => ({
      ...item,
      // 图片使用已检测且不可由客户端覆盖的发布副本；视频按产品要求直接发布，
      // 不交给 imgSecCheck，视频文件与其展示封面均保留原始 fileID。
      file_id: item.media_type === 'image'
        ? (publishedFileIds.get(item.file_id) || item.file_id)
        : item.file_id,
      poster_file_id: item.media_type === 'video' ? item.poster_file_id : ''
    }))
  }
}

async function getDocument(collection, id) {
  if (!id) return null
  try {
    const result = await collection.doc(id).get()
    return result.data || null
  } catch (error) {
    const message = (error && (error.errMsg || error.message)) || ''
    if (/document.*(?:not exist|not found)|cannot find document|document does not exist/i.test(message)) {
      return null
    }
    throw error
  }
}

function parseFileId(fileId) {
  const match = cleanText(fileId).match(FILE_ID_PATTERN)
  if (!match) return null
  return { environment: match[1], path: match[2], archiveFolder: match[3] }
}

function validateFileReferences(
  root,
  media,
  existing,
  openid,
  existingWorkingMedia = []
) {
  const expectedUploadToken = cleanText(existing && (existing.upload_token || existing._id))
  const configuredEnvironment = cleanText(existing && existing.cloud_environment_id)

  const allFileIds = [root.cover_image_file_id]
  media.forEach(item => {
    allFileIds.push(item.file_id)
    allFileIds.push(item.poster_file_id)
  })

  let environment = ''
  const expectedEnvironment = (() => {
    const existingIds = [
      existing && existing.cover_image_file_id,
      ...existingWorkingMedia.flatMap(item => [item.file_id, item.poster_file_id])
    ].filter(Boolean)
    const parsed = existingIds.map(parseFileId).find(Boolean)
    return parsed ? parsed.environment : ''
  })()
  const currentFileIds = new Set()
  if (existing) {
    const addExistingFile = fileId => {
      if (fileId) currentFileIds.add(cleanText(fileId))
    }
    addExistingFile(existing.cover_image_file_id)
    existingWorkingMedia.forEach(item => {
      addExistingFile(item.file_id)
      addExistingFile(item.poster_file_id)
    })
  }
  for (const fileId of allFileIds.filter(Boolean)) {
    const parsed = parseFileId(fileId)
    if (!parsed || (parsed.archiveFolder !== expectedUploadToken && !currentFileIds.has(fileId))) {
      throw serviceError('INVALID_FILE_REFERENCE', '图片或视频不是由当前档案上传的，请重新选择文件')
    }
    if (environment && environment !== parsed.environment) {
      throw serviceError('INVALID_FILE_REFERENCE', '图片或视频不属于当前云环境，请重新上传')
    }
    if (expectedEnvironment && expectedEnvironment !== parsed.environment) {
      throw serviceError('INVALID_FILE_REFERENCE', '图片或视频不属于当前云环境，请重新上传')
    }
    if (
      configuredEnvironment &&
      parsed.environment !== configuredEnvironment &&
      !parsed.environment.startsWith(`${configuredEnvironment}.`) &&
      !parsed.environment.startsWith(`${configuredEnvironment}-`)
    ) {
      throw serviceError('INVALID_FILE_REFERENCE', '图片或视频不属于当前云环境，请重新上传')
    }
    environment = parsed.environment
  }

  // openid 只在云函数内部使用；不接受客户端传入的 owner 字段。
  if (!openid) throw serviceError('AUTH_REQUIRED', '请先登录小程序后再上传媒体')
}

async function getAllByArchive(collection, archiveId) {
  const rows = []
  let skip = 0
  while (true) {
    const result = await collection
      .where({ archive_id: archiveId })
      .skip(skip)
      .limit(PAGE_SIZE)
      .get()
    const page = result.data || []
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
    skip += PAGE_SIZE
  }
  return rows.sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0))
}

async function getLegacyArchive(id) {
  const record = await getDocument(archives, id)
  return record && !record.record_type ? record : null
}

async function getArchiveRecord(id, recordType) {
  const record = await getDocument(archives, archiveRecordId(id, recordType))
  if (record) return record
  const legacy = await getLegacyArchive(id)
  if (!legacy) return null
  if (recordType === 'draft') return legacy
  const hasPublished = (
    (legacy.public_status === 'published' && legacy.published_snapshot) ||
    legacy.status === 'published'
  )
  if (!hasPublished) return null
  return {
    ...legacy,
    ...normalizeRoot(legacy.published_snapshot || legacy),
    archive_id: id,
    record_type: 'published',
    status: 'published'
  }
}

async function getOwnedArchive(id, openid, recordType = 'draft') {
  const archive = await getArchiveRecord(id, recordType)
  if (!archive) throw serviceError('NOT_FOUND', '档案不存在')
  if (archive.owner_openid !== openid) throw serviceError('FORBIDDEN', '没有权限操作这份档案')
  return archive
}

async function createArchiveId() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const id = randomId()
    const occupied = await Promise.all([
      getDocument(archives, id),
      getDocument(archives, archiveRecordId(id, 'draft')),
      getDocument(archives, archiveRecordId(id, 'published'))
    ])
    if (occupied.every(item => !item)) return id
  }
  throw serviceError('ID_GENERATION_FAILED', '档案编号生成失败，请重试')
}

function publicRoot(archive) {
  const snapshot = normalizeRoot(archive)
  return {
    _id: logicalArchiveId(archive),
    status: 'published',
    public_status: 'published',
    schema_version: archive.schema_version,
    ...snapshot,
    created_at: archive.created_at,
    updated_at: archive.published_at || archive.updated_at,
    published_at: archive.published_at
  }
}

function publicMedia(item) {
  return {
    media_id: item.media_id,
    section_key: item.section_key,
    media_type: item.media_type,
    file_id: item.file_id,
    poster_file_id: item.poster_file_id,
    duration_seconds: item.duration_seconds,
    sort_order: item.sort_order
  }
}

function publicCustomItem(item) {
  return {
    custom_item_id: item.custom_item_id,
    title: item.title,
    content: item.content,
    sort_order: item.sort_order
  }
}

function workingRows(rows, workingVersion = '') {
  const fixed = rows.filter(item => item.record_type === 'draft')
  if (fixed.length) return fixed
  const scoped = rows.filter(item => (
    item.record_scope === 'working' &&
    (!workingVersion || item.publication_id === workingVersion)
  ))
  return scoped.length ? scoped : rows.filter(item => !item.record_scope)
}

function publishedRows(rows, publishedVersion) {
  const fixed = rows.filter(item => item.record_type === 'published')
  if (fixed.length) return fixed
  if (publishedVersion) {
    return rows.filter(item => (
      item.record_scope === 'published' && item.publication_id === publishedVersion
    ))
  }
  // 兼容切换云数据库代码前已经生成的无 scope 数据。
  return rows.filter(item => !item.record_scope)
}

async function removeAllByArchive(collection, archiveId) {
  while (true) {
    const result = await collection.where({ archive_id: archiveId }).limit(PAGE_SIZE).get()
    const rows = result.data || []
    if (!rows.length) return
    for (const row of rows) await collection.doc(row._id).remove()
  }
}

function fixedRootRecord({
  id,
  recordType,
  root,
  openid,
  uploadToken,
  revision,
  createdAt,
  publicAvailable,
  environmentId,
  publishedAt,
  existing = {}
}) {
  return {
    _id: archiveRecordId(id, recordType),
    archive_id: id,
    record_type: recordType,
    ...root,
    owner_openid: openid,
    cloud_environment_id: cleanText(environmentId || existing.cloud_environment_id),
    upload_token: uploadToken,
    status: recordType === 'published' ? 'published' : existing.status === 'published' ? 'published' : 'draft',
    save_state: 'ready',
    public_status: publicAvailable ? 'published' : 'none',
    schema_version: CURRENT_SCHEMA_VERSION,
    revision,
    created_at: createdAt,
    updated_at: db.serverDate(),
    published_at: publishedAt || null,
    ...(recordType === 'published' ? {
      qr_code_file_id: cleanText(existing.qr_code_file_id),
      qr_code_version: Number(existing.qr_code_version) || 0,
      qr_code_mime_type: cleanText(existing.qr_code_mime_type),
      qr_code_updated_at: existing.qr_code_updated_at || null
    } : {})
  }
}

function fixedChildDocuments(
  existingRows,
  archiveId,
  openid,
  recordType,
  kind,
  stableKey,
  items
) {
  const existingById = new Map(existingRows.map(item => [item._id, item]))
  return items.map(item => {
    const documentId = childDocumentId(archiveId, kind, `${recordType}:${item[stableKey]}`)
    const existing = existingById.get(documentId)
    return {
      _id: documentId,
      archive_id: archiveId,
      owner_openid: openid,
      record_type: recordType,
      ...item,
      created_at: (existing && existing.created_at) || db.serverDate(),
      updated_at: db.serverDate()
    }
  })
}

async function setTransactionDocument(collection, record) {
  const { _id, ...data } = record
  await collection.doc(record._id).set({ data })
}

async function readTransactionDocument(collection, id) {
  try {
    const result = await collection.doc(id).get()
    return result.data || null
  } catch (error) {
    const message = cleanText(error && (error.errMsg || error.message))
    if (/document.*(?:not exist|not found)|cannot find document|document does not exist/i.test(message)) {
      return null
    }
    throw error
  }
}

async function commitFixedArchive({
  id,
  openid,
  expectedRevision,
  draftRecord,
  draftMedia,
  draftCustom,
  publishedRecord,
  publishedMedia,
  publishedCustom,
  existingDraftRows,
  existingPublishedRows,
  legacyRows,
  legacyExists
}) {
  if (typeof db.runTransaction !== 'function') {
    throw serviceError('DATABASE_TRANSACTION_UNAVAILABLE', '云数据库事务暂不可用，请重新部署云函数后重试')
  }
  const draftMediaDocs = fixedChildDocuments(
    existingDraftRows.media, id, openid, 'draft', 'media', 'media_id', draftMedia
  )
  const draftCustomDocs = fixedChildDocuments(
    existingDraftRows.custom, id, openid, 'draft', 'custom', 'custom_item_id', draftCustom
  )
  const publishedMediaDocs = publishedRecord ? fixedChildDocuments(
    existingPublishedRows.media, id, openid, 'published', 'media', 'media_id', publishedMedia
  ) : []
  const publishedCustomDocs = publishedRecord ? fixedChildDocuments(
    existingPublishedRows.custom, id, openid, 'published', 'custom', 'custom_item_id', publishedCustom
  ) : []

  return db.runTransaction(async transaction => {
    const txArchives = transaction.collection('tea_archives')
    const txMedia = transaction.collection('archive_media')
    const txCustom = transaction.collection('archive_custom_items')
    const currentDraft = await readTransactionDocument(txArchives, archiveRecordId(id, 'draft'))
    const currentLegacy = currentDraft || !legacyExists
      ? null
      : await readTransactionDocument(txArchives, id)
    const current = currentDraft || currentLegacy
    const actualRevision = Math.max(0, Number(current && current.revision) || 0)
    if (current && current.owner_openid !== openid) {
      throw serviceError('FORBIDDEN', '没有权限操作这份档案')
    }
    if (actualRevision !== expectedRevision) {
      throw serviceError('REVISION_CONFLICT', '这份档案已在其他设备更新，请重新打开后再修改')
    }

    for (const record of draftMediaDocs) await setTransactionDocument(txMedia, record)
    for (const record of draftCustomDocs) await setTransactionDocument(txCustom, record)
    const desiredDraftMedia = new Set(draftMediaDocs.map(item => item._id))
    const desiredDraftCustom = new Set(draftCustomDocs.map(item => item._id))
    for (const row of existingDraftRows.media) {
      if (!desiredDraftMedia.has(row._id)) await txMedia.doc(row._id).remove()
    }
    for (const row of existingDraftRows.custom) {
      if (!desiredDraftCustom.has(row._id)) await txCustom.doc(row._id).remove()
    }
    await setTransactionDocument(txArchives, draftRecord)

    if (publishedRecord) {
      for (const record of publishedMediaDocs) await setTransactionDocument(txMedia, record)
      for (const record of publishedCustomDocs) await setTransactionDocument(txCustom, record)
      const desiredPublishedMedia = new Set(publishedMediaDocs.map(item => item._id))
      const desiredPublishedCustom = new Set(publishedCustomDocs.map(item => item._id))
      for (const row of existingPublishedRows.media) {
        if (!desiredPublishedMedia.has(row._id)) await txMedia.doc(row._id).remove()
      }
      for (const row of existingPublishedRows.custom) {
        if (!desiredPublishedCustom.has(row._id)) await txCustom.doc(row._id).remove()
      }
      await setTransactionDocument(txArchives, publishedRecord)
    }

    for (const row of legacyRows.media) await txMedia.doc(row._id).remove()
    for (const row of legacyRows.custom) await txCustom.doc(row._id).remove()
    if (legacyExists) await txArchives.doc(id).remove()
    return { revision: draftRecord.revision }
  })
}

async function saveComposite(event, openid, environmentId) {
  const input = event.archive || {}
  const publishing = input.status === 'published'
  const root = normalizeRoot(input.root)
  const media = normalizeMedia(input.media)
  const customItems = normalizeCustomItems(input.custom_items, publishing)

  if (publishing) validatePublish(root)

  const id = cleanText(input.id)
  if (!id) throw serviceError('DRAFT_NOT_RESERVED', '新档案尚未准备完成，请返回列表后重新创建')
  const draftId = archiveRecordId(id, 'draft')
  const publishedId = archiveRecordId(id, 'published')
  const [fixedDraft, fixedPublished, legacy] = await Promise.all([
    getDocument(archives, draftId),
    getDocument(archives, publishedId),
    getLegacyArchive(id)
  ])
  const existing = fixedDraft || legacy
  for (const record of [existing, fixedPublished].filter(Boolean)) {
    if (record.owner_openid !== openid) throw serviceError('FORBIDDEN', '没有权限操作这份档案')
  }
  const expectedToken = ownerUploadToken(openid, id)
  const suppliedToken = cleanText(input.upload_token)
  const uploadToken = cleanText(existing && existing.upload_token) || expectedToken
  if (!existing && suppliedToken !== expectedToken) {
    throw serviceError('DRAFT_NOT_RESERVED', '新档案尚未准备完成，请返回列表后重新创建')
  }

  const expectedRevision = Math.max(0, Number(input.revision) || 0)
  const actualRevision = Math.max(0, Number(existing && existing.revision) || 0)
  if (expectedRevision !== actualRevision) {
    throw serviceError('REVISION_CONFLICT', '这份档案已在其他设备更新，请重新打开后再修改')
  }
  const allMediaRows = await getAllByArchive(mediaCollection, id)
  const allCustomRows = await getAllByArchive(customCollection, id)
  const existingWorkingMedia = workingRows(allMediaRows, cleanText(existing && existing.working_version))
  const validationRecord = existing || {
    _id: draftId,
    upload_token: uploadToken,
    cloud_environment_id: cleanText(environmentId)
  }
  validateFileReferences(
    root,
    media,
    validationRecord,
    openid,
    existingWorkingMedia
  )
  const legacyPublished = legacy && (
    (legacy.public_status === 'published' && legacy.published_snapshot) || legacy.status === 'published'
  ) ? legacy : null
  const existingPublished = fixedPublished || legacyPublished
  const existingPublishedRows = existingPublished
    ? publishedRows(allMediaRows, cleanText(existingPublished.published_version))
    : []
  const existingPublishedCustom = existingPublished
    ? publishedRows(allCustomRows, cleanText(existingPublished.published_version))
    : []
  const existingPublishedFileIds = publishedFileIdsFromVersion(
    existingPublished && normalizeRoot(existingPublished.published_snapshot || existingPublished),
    existingPublishedRows
  )
  const nextRevision = actualRevision + 1
  const nextPublishedVersion = publishing ? publicationId() : ''
  let publishedContent = null
  if (publishing) {
    // 先检测，再由云函数把已通过的图片复制到客户端不可写的发布目录。
    // 整个过程都在三表写入之前，失败不会改变 revision 或上一版公开档案。
    publishedContent = await preparePublishedContent(
      root,
      media,
      customItems,
      openid,
      id,
      nextPublishedVersion
    )
  }

  const createdAt = (existing && existing.created_at) || db.serverDate()
  const publishedAt = publishing
    ? db.serverDate()
    : (existingPublished && existingPublished.published_at) || null
  const draftRecord = fixedRootRecord({
    id,
    recordType: 'draft',
    root,
    openid,
    uploadToken,
    revision: nextRevision,
    createdAt,
    publicAvailable: Boolean(existingPublished || publishing),
    environmentId,
    publishedAt,
    existing: { ...(existing || {}), status: publishing ? 'published' : 'draft' }
  })
  let publishedRecord = null
  let publishedMedia = []
  let publishedCustom = []
  if (publishing) {
    publishedMedia = publishedContent.media
    publishedCustom = customItems
    publishedRecord = fixedRootRecord({
      id,
      recordType: 'published',
      root: publishedContent.root,
      openid,
      uploadToken,
      revision: Math.max(0, Number(existingPublished && existingPublished.revision) || 0) + 1,
      createdAt: (existingPublished && existingPublished.created_at) || createdAt,
      publicAvailable: true,
      environmentId,
      publishedAt,
      existing: existingPublished || {}
    })
  } else if (!fixedPublished && legacyPublished) {
    publishedMedia = existingPublishedRows.map(publicMedia)
    publishedCustom = existingPublishedCustom.map(publicCustomItem)
    publishedRecord = fixedRootRecord({
      id,
      recordType: 'published',
      root: normalizeRoot(legacyPublished.published_snapshot || legacyPublished),
      openid,
      uploadToken,
      revision: Math.max(1, Number(legacyPublished.revision) || 1),
      createdAt: legacyPublished.created_at || createdAt,
      publicAvailable: true,
      environmentId,
      publishedAt: legacyPublished.published_at || legacyPublished.updated_at,
      existing: legacyPublished
    })
  }

  try {
    // draft / published 的主记录和子记录都使用固定键；一个事务内覆盖，不再创建历史版本。
    await commitFixedArchive({
      id,
      openid,
      expectedRevision,
      draftRecord,
      draftMedia: media,
      draftCustom: customItems,
      publishedRecord,
      publishedMedia,
      publishedCustom,
      existingDraftRows: {
        media: allMediaRows.filter(item => item.record_type === 'draft'),
        custom: allCustomRows.filter(item => item.record_type === 'draft')
      },
      existingPublishedRows: {
        media: allMediaRows.filter(item => item.record_type === 'published'),
        custom: allCustomRows.filter(item => item.record_type === 'published')
      },
      legacyRows: {
        media: allMediaRows.filter(item => !item.record_type),
        custom: allCustomRows.filter(item => !item.record_type)
      },
      legacyExists: Boolean(legacy)
    })
  } catch (error) {
    if (publishedContent) {
      await Promise.allSettled([removeCloudFiles(publishedFileIdsFromVersion(
        publishedContent.root,
        publishedContent.media
      ))])
    }
    throw error
  }

  const cleanupTasks = []
  if (publishing) {
    cleanupTasks.push(removeCloudFiles(existingPublishedFileIds))
  }
  const cleanupResults = await Promise.allSettled(cleanupTasks)
  if (cleanupResults.some(result => result.status === 'rejected')) {
    console.error('[archiveService] cleanup previous version incomplete', id)
  }

  return getCompositeForOwner(id, openid)
}

async function startDraft(openid, environmentId) {
  const id = await createArchiveId()
  // 只签发逻辑 ID 和上传目录；用户真正保存前不向 tea_archives 写任何记录。
  return { id, upload_token: ownerUploadToken(openid, id), revision: 0 }
}

function isEmptyLegacyReservation(record) {
  if (!record || record.record_type || record.save_state !== 'reserved') return false
  if (Math.max(0, Number(record.revision) || 0) !== 0) return false
  if (record.public_status === 'published' || record.published_snapshot) return false
  return Object.values(normalizeRoot(record)).every(value => !value)
}

async function cleanupLegacyReservations(rows, openid) {
  const targets = rows.filter(item => item.owner_openid === openid && isEmptyLegacyReservation(item))
  for (const item of targets) {
    const id = logicalArchiveId(item)
    try {
      await removeAllByArchive(mediaCollection, id)
      await removeAllByArchive(customCollection, id)
      await archives.doc(item._id).remove()
    } catch (error) {
      console.error('[archiveService] cleanup legacy reservation', item._id)
    }
  }
}

async function listMine(openid) {
  const rows = []
  let skip = 0
  while (true) {
    const result = await archives
      .where({ owner_openid: openid })
      .skip(skip)
      .limit(PAGE_SIZE)
      .get()
    const page = result.data || []
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
    skip += PAGE_SIZE
  }
  await cleanupLegacyReservations(rows, openid)
  const publishedIds = new Set(rows
    .filter(item => item.record_type === 'published')
    .map(logicalArchiveId))
  const draftRows = rows.filter(item => item.record_type === 'draft')
  const fixedDraftIds = new Set(draftRows.map(logicalArchiveId))
  const legacyRows = rows.filter(item => !item.record_type && !isEmptyLegacyReservation(item))
  return draftRows
    .concat(legacyRows.filter(item => !fixedDraftIds.has(logicalArchiveId(item))))
    .map(item => {
      const id = logicalArchiveId(item)
      const legacyPublished = !item.record_type && (
        (item.public_status === 'published' && item.published_snapshot) || item.status === 'published'
      )
      return {
        ...item,
        _id: id,
        public_status: publishedIds.has(id) || legacyPublished ? 'published' : 'none'
      }
    })
    .sort((a, b) => timestampValue(b.updated_at) - timestampValue(a.updated_at))
}

async function getCompositeForOwner(id, openid) {
  const root = await getOwnedArchive(id, openid)
  const [allMedia, allCustomItems] = await Promise.all([
    getAllByArchive(mediaCollection, id),
    getAllByArchive(customCollection, id)
  ])
  return resolveOwnerPreviewUrls({
    root: {
      ...root,
      _id: id,
      upload_token: cleanText(root.upload_token) || ownerUploadToken(openid, id)
    },
    media: workingRows(allMedia, cleanText(root.working_version)),
    custom_items: workingRows(allCustomItems, cleanText(root.working_version))
  })
}

async function getPublicComposite(id) {
  const archive = await getArchiveRecord(id, 'published')
  if (!archive) throw serviceError('NOT_FOUND', '没有找到已生成的档案')
  const [allMedia, allCustomItems] = await Promise.all([
    getAllByArchive(mediaCollection, id),
    getAllByArchive(customCollection, id)
  ])
  const publishedVersion = cleanText(archive.published_version)
  const composite = {
    root: publicRoot(archive),
    media: publishedRows(allMedia, publishedVersion).map(publicMedia),
    custom_items: publishedRows(allCustomItems, publishedVersion).map(publicCustomItem)
  }
  const latest = await getArchiveRecord(id, 'published')
  if (!latest || Number(latest.revision || 0) !== Number(archive.revision || 0)) {
    throw serviceError('PUBLICATION_CHANGED', '档案刚刚更新，请重新打开')
  }
  return resolvePublicFileUrls(composite)
}

async function recordArchiveView(id, openid) {
  if (!id) throw serviceError('NOT_FOUND', '没有找到已生成的档案')
  const archive = await getArchiveRecord(id, 'published')
  if (!archive) throw serviceError('NOT_FOUND', '没有找到已生成的档案')

  const documentId = historyDocumentId(openid, id)
  await db.runTransaction(async transaction => {
    const collection = transaction.collection('archive_view_history')
    const existing = await readTransactionDocument(collection, documentId)
    await setTransactionDocument(collection, {
      _id: documentId,
      owner_openid: openid,
      archive_id: id,
      first_viewed_at: (existing && existing.first_viewed_at) || db.serverDate(),
      last_viewed_at: db.serverDate()
    })
  })
  return { archive_id: id }
}

async function listViewHistory(openid) {
  const rows = []
  let skip = 0
  while (true) {
    const result = await historyCollection
      .where({ owner_openid: openid })
      .skip(skip)
      .limit(PAGE_SIZE)
      .get()
    const page = result.data || []
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
    skip += PAGE_SIZE
  }
  rows.sort((left, right) => (
    timestampValue(right.last_viewed_at) - timestampValue(left.last_viewed_at)
  ))

  const result = new Array(rows.length)
  await runWithConcurrency(rows, 10, async (row, index) => {
    const archiveId = cleanText(row.archive_id)
    const published = archiveId ? await getArchiveRecord(archiveId, 'published') : null
    if (!published) return
    result[index] = {
      archive_id: archiveId,
      tea_name: cleanText(published.tea_name),
      tea_type: cleanText(published.tea_type),
      last_viewed_at: row.last_viewed_at
    }
  })
  return result.filter(Boolean)
}

function qrCodePayload(fileId, buffer, mimeType = 'image/jpeg') {
  if (!fileId || !Buffer.isBuffer(buffer) || !buffer.length) return null
  return {
    file_id: fileId,
    file_base64: buffer.toString('base64'),
    mime_type: mimeType === 'image/png' ? 'image/png' : 'image/jpeg'
  }
}

async function downloadQrCode(fileId, mimeType) {
  if (!fileId) return null
  try {
    const result = await cloud.downloadFile({ fileID: fileId })
    return qrCodePayload(fileId, result && result.fileContent, mimeType)
  } catch (error) {
    // 缓存文件被手工删除或暂时不可读时重新生成，不让旧缓存永久阻断小程序码。
    return null
  }
}

async function generateArchiveQrCode(id, openid) {
  const archive = await getArchiveRecord(id, 'published')
  if (!archive) {
    throw serviceError('QR_ARCHIVE_NOT_PUBLISHED', '请先生成档案，再创建小程序码')
  }
  if (archive.owner_openid !== openid) throw serviceError('FORBIDDEN', '没有权限操作这份档案')
  const teaName = cleanText(archive.tea_name)

  const cachedFileId = cleanText(archive.qr_code_file_id)
  if (cachedFileId && Number(archive.qr_code_version) === QR_CODE_VERSION) {
    const cached = await downloadQrCode(cachedFileId, cleanText(archive.qr_code_mime_type))
    if (cached) {
      return {
        ...cached,
        archive_id: id,
        tea_name: teaName,
        cache_status: 'hit'
      }
    }
  }

  let codeResult
  try {
    codeResult = await cloud.openapi.wxacode.getUnlimited({
      scene: id,
      page: QR_CODE_PAGE,
      width: 430,
      autoColor: false,
      lineColor: { r: 31, g: 86, b: 71 },
      isHyaline: false,
      // 页面路径固定在代码内；关闭路径预检后，首次正式发布前也能完成联调。
      // 小程序码扫码时始终进入正式版，因此正式使用前仍必须发布包含该页面的版本。
      checkPath: false,
      envVersion: 'release'
    })
  } catch (error) {
    const code = numericSecurityCode(error)
    if (code === 41030) {
      throw serviceError('QR_PAGE_NOT_RELEASED', '正式版尚未包含档案页面，请先发布小程序后再重试')
    }
    throw serviceError('QR_CODE_GENERATION_FAILED', '小程序码生成失败，请稍后重试')
  }

  const buffer = codeResult && codeResult.buffer
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw serviceError('QR_CODE_GENERATION_FAILED', '微信未返回有效的小程序码，请稍后重试')
  }
  const mimeType = cleanText(codeResult.contentType).toLowerCase() === 'image/png'
    ? 'image/png'
    : 'image/jpeg'
  const extension = mimeType === 'image/png' ? 'png' : 'jpg'

  let uploadResult
  try {
    uploadResult = await cloud.uploadFile({
      cloudPath: `tea-archives-published/codes/${id}/code-v${QR_CODE_VERSION}.${extension}`,
      fileContent: buffer
    })
  } catch (error) {
    throw serviceError('QR_CODE_UPLOAD_FAILED', '小程序码保存失败，请稍后重试')
  }
  const fileId = cleanText(uploadResult && (uploadResult.fileID || uploadResult.fileId))
  if (!fileId) throw serviceError('QR_CODE_UPLOAD_FAILED', '小程序码保存失败，请稍后重试')

  const fixedPublished = await getDocument(archives, archiveRecordId(id, 'published'))
  await archives.doc(fixedPublished ? archiveRecordId(id, 'published') : id).update({
    data: {
      qr_code_file_id: fileId,
      qr_code_version: QR_CODE_VERSION,
      qr_code_mime_type: mimeType,
      qr_code_updated_at: db.serverDate()
    }
  })
  const payload = qrCodePayload(fileId, buffer, mimeType)
  if (!payload) throw serviceError('QR_CODE_GENERATION_FAILED', '微信未返回有效的小程序码，请稍后重试')
  return {
    ...payload,
    archive_id: id,
    tea_name: teaName,
    cache_status: 'generated'
  }
}

async function getTempUrlMap(composite) {
  const fileIds = new Set()
  const cover = composite.root.cover_image_file_id
  if (cover) fileIds.add(cover)
  composite.media.forEach(item => {
    if (item.file_id) fileIds.add(item.file_id)
    if (item.poster_file_id) fileIds.add(item.poster_file_id)
  })

  const urls = new Map()
  const pending = Array.from(fileIds)
  for (let index = 0; index < pending.length; index += 50) {
    const result = await cloud.getTempFileURL({ fileList: pending.slice(index, index + 50) })
    ;(result.fileList || []).forEach(item => {
      if (item.fileID && item.tempFileURL && (item.status === undefined || item.status === 0)) {
        urls.set(item.fileID, item.tempFileURL)
      }
    })
  }
  return urls
}

async function resolveOwnerPreviewUrls(composite) {
  let urls
  try {
    urls = await getTempUrlMap(composite)
  } catch (error) {
    console.error('[archiveService] owner preview urls', composite.root._id, error)
    return composite
  }
  const cover = composite.root.cover_image_file_id
  return {
    ...composite,
    root: {
      ...composite.root,
      cover_image_preview_url: urls.get(cover) || cover,
      preview_warning: cover && !urls.has(cover) ? '部分媒体预览暂时无法加载' : ''
    },
    media: composite.media.map(item => ({
      ...item,
      preview_url: urls.get(item.file_id) || item.file_id,
      poster_preview_url: urls.get(item.poster_file_id) || item.poster_file_id
    }))
  }
}

async function resolvePublicFileUrls(composite) {
  const cover = composite.root.cover_image_file_id
  const urls = await getTempUrlMap(composite)
  if (cover && !urls.has(cover)) {
    throw serviceError('PUBLIC_MEDIA_UNAVAILABLE', '档案主视觉暂时无法加载，请稍后重试')
  }

  return {
    ...composite,
    root: {
      ...composite.root,
      cover_image_file_id: urls.get(cover) || cover
    },
    media: composite.media
      .filter(item => urls.has(item.file_id))
      .map(item => ({
        ...item,
        file_id: urls.get(item.file_id),
        poster_file_id: urls.get(item.poster_file_id) || ''
      }))
  }
}

async function copyComposite(id, openid) {
  const source = await getCompositeForOwner(id, openid)
  const newId = await createArchiveId()
  const root = normalizeRoot(source.root)
  root.tea_name = `${root.tea_name || '未命名'}（副本）`
  const uploadToken = ownerUploadToken(openid, newId)
  const draftRecord = fixedRootRecord({
    id: newId,
    recordType: 'draft',
    root,
    openid,
    uploadToken,
    revision: 1,
    createdAt: db.serverDate(),
    publicAvailable: false,
    environmentId: cleanText(source.root.cloud_environment_id),
    publishedAt: null,
    existing: { status: 'draft' }
  })
  await commitFixedArchive({
    id: newId,
    openid,
    expectedRevision: 0,
    draftRecord,
    draftMedia: normalizeMedia(source.media),
    draftCustom: normalizeCustomItems(source.custom_items, false),
    publishedRecord: null,
    publishedMedia: [],
    publishedCustom: [],
    existingDraftRows: { media: [], custom: [] },
    existingPublishedRows: { media: [], custom: [] },
    legacyRows: { media: [], custom: [] },
    legacyExists: false
  })
  return getCompositeForOwner(newId, openid)
}

async function deleteComposite(id, openid) {
  const [draft, published, legacy] = await Promise.all([
    getDocument(archives, archiveRecordId(id, 'draft')),
    getDocument(archives, archiveRecordId(id, 'published')),
    getLegacyArchive(id)
  ])
  const existing = draft || published || legacy
  if (!existing) throw serviceError('NOT_FOUND', '档案不存在')
  if (existing.owner_openid !== openid) throw serviceError('FORBIDDEN', '没有权限操作这份档案')
  const publishedSource = published || (legacy && (
    (legacy.public_status === 'published' && legacy.published_snapshot) || legacy.status === 'published'
  ) ? legacy : null)
  const allMedia = await getAllByArchive(mediaCollection, id)
  const publishedMediaRows = publishedSource
    ? publishedRows(allMedia, cleanText(publishedSource.published_version))
    : []
  const publishedFileIds = publishedFileIdsFromVersion(
    publishedSource && normalizeRoot(publishedSource.published_snapshot || publishedSource),
    publishedMediaRows
  )
  const qrCodeFileId = cleanText(publishedSource && publishedSource.qr_code_file_id)
  // 先清理只属于当前档案的发布副本；失败时保留主记录与指针，下一次删除可继续重试。
  await removeCloudFiles(publishedFileIds.concat(qrCodeFileId ? [qrCodeFileId] : []))
  await removeAllByArchive(mediaCollection, id)
  await removeAllByArchive(customCollection, id)
  await Promise.all([
    draft ? archives.doc(archiveRecordId(id, 'draft')).remove() : null,
    published ? archives.doc(archiveRecordId(id, 'published')).remove() : null,
    legacy ? archives.doc(id).remove() : null
  ])
  try {
    await removeAllByArchive(historyCollection, id)
  } catch (error) {
    // 历史行只保存引用，档案已删除后不会再被 listHistory 返回；清理失败不反向阻止删档。
    console.error('[archiveService] cleanup view history', id)
  }
  // 草稿原文件可能由复制档案共享，仍不删除。
  return { id }
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  const environmentId = cleanText(process.env.TCB_ENV || process.env.SCF_NAMESPACE)
  try {
    if (event.action !== 'getPublicArchive' && !OPENID) {
      throw serviceError('AUTH_REQUIRED', '请先登录小程序后再操作档案')
    }
    let data
    switch (event.action) {
      case 'listMine':
        data = await listMine(OPENID)
        break
      case 'getForEdit':
        data = await getCompositeForOwner(cleanText(event.id), OPENID)
        break
      case 'startDraft':
        data = await startDraft(OPENID, environmentId)
        break
      case 'getPublicArchive':
        data = await getPublicComposite(cleanText(event.id))
        break
      case 'recordView':
        data = await recordArchiveView(cleanText(event.id), OPENID)
        break
      case 'listHistory':
        data = await listViewHistory(OPENID)
        break
      case 'getQrCode':
        data = await generateArchiveQrCode(cleanText(event.id), OPENID)
        break
      case 'save':
        data = await saveComposite(event, OPENID, environmentId)
        break
      case 'copy':
        data = await copyComposite(cleanText(event.id), OPENID)
        break
      case 'delete':
        data = await deleteComposite(cleanText(event.id), OPENID)
        break
      default:
        throw serviceError('UNKNOWN_ACTION', '不支持的档案操作')
    }
    return { ok: true, data }
  } catch (error) {
    // 内容安全错误只记录业务码，不把用户文本、图片 Buffer 或完整请求写入日志。
    console.error(
      '[archiveService]',
      event.action,
      error && (error.code || error.errCode || error.errcode || error.message || 'UNKNOWN_ERROR')
    )
    return {
      ok: false,
      error: {
        code: error.code || 'CLOUD_DATABASE_ERROR',
        message: error.message || '云数据库操作失败'
      }
    }
  }
}
