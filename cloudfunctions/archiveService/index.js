const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const archives = db.collection('tea_archives')
const mediaCollection = db.collection('archive_media')
const customCollection = db.collection('archive_custom_items')

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

function publicationId() {
  return `p_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`
}

function workingVersionId() {
  return `w_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`
}

function archiveUploadToken() {
  return `u_${crypto.randomBytes(16).toString('hex')}`
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
      await callback(items[index])
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

async function getOwnedArchive(id, openid) {
  const archive = await getDocument(archives, id)
  if (!archive) throw serviceError('NOT_FOUND', '档案不存在')
  if (archive.owner_openid !== openid) throw serviceError('FORBIDDEN', '没有权限操作这份档案')
  return archive
}

async function createArchiveId() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const id = randomId()
    if (!(await getDocument(archives, id))) return id
  }
  throw serviceError('ID_GENERATION_FAILED', '档案编号生成失败，请重试')
}

function publicRoot(archive) {
  const snapshot = archive.published_snapshot
    ? normalizeRoot(archive.published_snapshot)
    : normalizeRoot(archive)
  return {
    _id: archive._id,
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
  const scoped = rows.filter(item => (
    item.record_scope === 'working' &&
    (!workingVersion || item.publication_id === workingVersion)
  ))
  return scoped.length ? scoped : rows.filter(item => !item.record_scope)
}

function publishedRows(rows, publishedVersion) {
  if (publishedVersion) {
    return rows.filter(item => (
      item.record_scope === 'published' && item.publication_id === publishedVersion
    ))
  }
  // 兼容切换云数据库代码前已经生成的无 scope 数据。
  return rows.filter(item => !item.record_scope)
}

async function syncChildCollection(
  collection,
  archiveId,
  openid,
  kind,
  stableKey,
  items,
  options = {}
) {
  const scope = options.scope || 'working'
  const publishedVersion = options.publicationId || ''
  const slot = publishedVersion || scope
  const allRows = await getAllByArchive(collection, archiveId)
  const existingRows = allRows.filter(item => {
    if (item.record_scope === scope) {
      return !publishedVersion || item.publication_id === publishedVersion
    }
    return Boolean(options.includeLegacy && !item.record_scope)
  })
  const existingById = new Map(existingRows.map(item => [item._id, item]))
  const desiredIds = new Set()

  // 先逐项写入，再删除已经不存在的旧项。网络异常时根档案仍是 draft，重试也不会产生重复记录。
  for (const item of items) {
    const documentId = childDocumentId(archiveId, kind, `${slot}:${item[stableKey]}`)
    desiredIds.add(documentId)
    const data = {
      archive_id: archiveId,
      owner_openid: openid,
      record_scope: scope,
      publication_id: publishedVersion,
      ...item,
      updated_at: db.serverDate()
    }
    if (existingById.has(documentId)) {
      await collection.doc(documentId).update({ data })
    } else {
      await collection.add({
        data: {
          _id: documentId,
          ...data,
          created_at: db.serverDate()
        }
      })
    }
  }

  for (const row of existingRows) {
    if (!desiredIds.has(row._id)) await collection.doc(row._id).remove()
  }
}

async function replaceChildren(archiveId, openid, media, customItems, options = {}) {
  await syncChildCollection(mediaCollection, archiveId, openid, 'media', 'media_id', media, options)
  await syncChildCollection(customCollection, archiveId, openid, 'custom', 'custom_item_id', customItems, options)
}

async function cleanupOldChildren(collection, archiveId, scope, currentVersion) {
  const rows = await getAllByArchive(collection, archiveId)
  for (const row of rows) {
    const isOldVersion = row.record_scope === scope && row.publication_id !== currentVersion
    const isLegacy = scope === 'published' && !row.record_scope
    if (isOldVersion || isLegacy) await collection.doc(row._id).remove()
  }
}

async function removeChildVersion(collection, archiveId, scope, version) {
  const rows = await getAllByArchive(collection, archiveId)
  for (const row of rows) {
    if (row.record_scope === scope && row.publication_id === version) {
      await collection.doc(row._id).remove()
    }
  }
}

async function removeCompositeVersion(archiveId, scope, version) {
  if (!version) return
  await removeChildVersion(mediaCollection, archiveId, scope, version)
  await removeChildVersion(customCollection, archiveId, scope, version)
}

async function removeAllByArchive(collection, archiveId) {
  while (true) {
    const result = await collection.where({ archive_id: archiveId }).limit(PAGE_SIZE).get()
    const rows = result.data || []
    if (!rows.length) return
    for (const row of rows) await collection.doc(row._id).remove()
  }
}

async function saveComposite(event, openid) {
  const input = event.archive || {}
  const publishing = input.status === 'published'
  const root = normalizeRoot(input.root)
  const media = normalizeMedia(input.media)
  const customItems = normalizeCustomItems(input.custom_items, publishing)

  if (publishing) validatePublish(root)

  let id = cleanText(input.id)
  let existing = null
  if (id) existing = await getOwnedArchive(id, openid)
  else id = await createArchiveId()

  if (!existing) {
    throw serviceError('DRAFT_NOT_RESERVED', '新档案尚未准备完成，请返回列表后重新创建')
  }

  const expectedRevision = Math.max(0, Number(input.revision) || 0)
  const actualRevision = existing ? Math.max(0, Number(existing.revision) || 0) : 0
  if (existing && expectedRevision !== actualRevision) {
    throw serviceError('REVISION_CONFLICT', '这份档案已在其他设备更新，请重新打开后再修改')
  }
  let existingWorkingMedia = []
  if (existing) {
    existingWorkingMedia = workingRows(
      await getAllByArchive(mediaCollection, id),
      cleanText(existing.working_version)
    )
  }
  validateFileReferences(
    root,
    media,
    existing,
    openid,
    existingWorkingMedia
  )
  const existingSnapshot = existing && (
    existing.published_snapshot || (existing.status === 'published' ? normalizeRoot(existing) : null)
  )
  const existingPublicStatus = existingSnapshot ? 'published' : 'none'
  const existingPublishedVersion = existing && cleanText(existing.published_version)
  const existingPublishedRows = existingPublishedVersion
    ? publishedRows(await getAllByArchive(mediaCollection, id), existingPublishedVersion)
    : []
  const existingPublishedFileIds = publishedFileIdsFromVersion(
    existingSnapshot,
    existingPublishedRows
  )
  const nextRevision = actualRevision + 1
  const nextWorkingVersion = workingVersionId()
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

  try {
    // 新子记录使用独立版本暂存；主记录尚未切换前，编辑页和消费者都仍读取旧版本。
    await replaceChildren(id, openid, media, customItems, {
      scope: 'working',
      publicationId: nextWorkingVersion
    })
    if (publishing) {
      await replaceChildren(id, openid, publishedContent.media, customItems, {
        scope: 'published',
        publicationId: nextPublishedVersion
      })
    }

    const finalRecord = {
      ...root,
      owner_openid: openid,
      upload_token: cleanText(existing.upload_token) || id,
      status: publishing ? 'published' : 'draft',
      save_state: 'ready',
      public_status: publishing ? 'published' : existingPublicStatus,
      // Cloud Database 的普通对象 update 会被解释为更新嵌套字段。
      // 首次发布时 published_snapshot 仍是 null，必须用 set 原子替换整项，
      // 否则会报 Cannot create field ... in element { published_snapshot: null }。
      published_snapshot: db.command.set(
        publishing ? publishedContent.root : existingSnapshot || null
      ),
      published_version: publishing ? nextPublishedVersion : existingPublishedVersion,
      schema_version: CURRENT_SCHEMA_VERSION,
      revision: nextRevision,
      working_version: nextWorkingVersion,
      updated_at: db.serverDate(),
      published_at: publishing ? db.serverDate() : (existing && existing.published_at) || null
    }

    // 乐观锁：只有仍处于读取时 revision 的主记录才能切换到新版本。
    const updateResult = await archives.where({
      _id: id,
      owner_openid: openid,
      revision: expectedRevision
    }).update({ data: finalRecord })
    const updated = Number(
      updateResult && (
        (updateResult.stats && updateResult.stats.updated) ||
        updateResult.updated ||
        updateResult.updatedCount
      )
    )
    if (updated !== 1) {
      throw serviceError('REVISION_CONFLICT', '这份档案已在其他设备更新，请重新打开后再修改')
    }
  } catch (error) {
    const rollbackTasks = [
      removeCompositeVersion(id, 'working', nextWorkingVersion),
      removeCompositeVersion(id, 'published', nextPublishedVersion)
    ]
    if (publishedContent) {
      rollbackTasks.push(removeCloudFiles(publishedFileIdsFromVersion(
        publishedContent.root,
        publishedContent.media
      )))
    }
    const rollbackResults = await Promise.allSettled(rollbackTasks)
    if (rollbackResults.some(result => result.status === 'rejected')) {
      console.error('[archiveService] save rollback incomplete', id)
    }
    throw error
  }

  // 只清理本次保存开始时捕获的旧版本，绝不扫描删除其他并发请求正在暂存的新版本。
  const cleanupTasks = [
    removeCompositeVersion(id, 'working', cleanText(existing.working_version))
  ]
  if (publishing) {
    cleanupTasks.push(removeCompositeVersion(id, 'published', existingPublishedVersion))
    cleanupTasks.push(removeCloudFiles(existingPublishedFileIds))
    if (!existingPublishedVersion) {
      cleanupTasks.push((async () => {
        const legacyMedia = (await getAllByArchive(mediaCollection, id)).filter(item => !item.record_scope)
        const legacyCustom = (await getAllByArchive(customCollection, id)).filter(item => !item.record_scope)
        for (const row of legacyMedia) await mediaCollection.doc(row._id).remove()
        for (const row of legacyCustom) await customCollection.doc(row._id).remove()
      })())
    }
  }
  const cleanupResults = await Promise.allSettled(cleanupTasks)
  if (cleanupResults.some(result => result.status === 'rejected')) {
    console.error('[archiveService] cleanup previous version incomplete', id)
  }

  return getCompositeForOwner(id, openid)
}

async function startDraft(openid, environmentId) {
  const id = await createArchiveId()
  const uploadToken = archiveUploadToken()
  await archives.add({
    data: {
      _id: id,
      ...normalizeRoot({}),
      owner_openid: openid,
      cloud_environment_id: cleanText(environmentId),
      upload_token: uploadToken,
      status: 'draft',
      save_state: 'reserved',
      public_status: 'none',
      published_snapshot: null,
      published_version: '',
      working_version: '',
      schema_version: CURRENT_SCHEMA_VERSION,
      revision: 0,
      created_at: db.serverDate(),
      updated_at: db.serverDate(),
      published_at: null
    }
  })
  return { id, upload_token: uploadToken, revision: 0 }
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
  return rows
    .filter(item => item.save_state !== 'reserved')
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
      upload_token: cleanText(root.upload_token) || root._id
    },
    media: workingRows(allMedia, cleanText(root.working_version)),
    custom_items: workingRows(allCustomItems, cleanText(root.working_version))
  })
}

async function getPublicComposite(id) {
  const archive = await getDocument(archives, id)
  const hasPublicSnapshot = archive && (
    (archive.public_status === 'published' && archive.published_snapshot) ||
    archive.status === 'published'
  )
  if (!hasPublicSnapshot) throw serviceError('NOT_FOUND', '没有找到已生成的档案')
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
  const latest = await getDocument(archives, id)
  if (!latest || cleanText(latest.published_version) !== publishedVersion) {
    throw serviceError('PUBLICATION_CHANGED', '档案刚刚更新，请重新打开')
  }
  return resolvePublicFileUrls(composite)
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
  const archive = await getOwnedArchive(id, openid)
  const hasPublicSnapshot = (
    (archive.public_status === 'published' && archive.published_snapshot) ||
    archive.status === 'published'
  )
  if (!hasPublicSnapshot) {
    throw serviceError('QR_ARCHIVE_NOT_PUBLISHED', '请先生成档案，再创建小程序码')
  }

  const cachedFileId = cleanText(archive.qr_code_file_id)
  if (cachedFileId && Number(archive.qr_code_version) === QR_CODE_VERSION) {
    const cached = await downloadQrCode(cachedFileId, cleanText(archive.qr_code_mime_type))
    if (cached) return cached
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

  await archives.doc(id).update({
    data: {
      qr_code_file_id: fileId,
      qr_code_version: QR_CODE_VERSION,
      qr_code_mime_type: mimeType,
      qr_code_updated_at: db.serverDate()
    }
  })
  const payload = qrCodePayload(fileId, buffer, mimeType)
  if (!payload) throw serviceError('QR_CODE_GENERATION_FAILED', '微信未返回有效的小程序码，请稍后重试')
  return payload
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

  try {
    const newWorkingVersion = workingVersionId()
    await archives.add({
      data: {
        _id: newId,
        ...root,
        owner_openid: openid,
        cloud_environment_id: cleanText(source.root.cloud_environment_id),
        upload_token: archiveUploadToken(),
        status: 'draft',
        save_state: 'ready',
        public_status: 'none',
        published_snapshot: null,
        published_version: '',
        schema_version: CURRENT_SCHEMA_VERSION,
        revision: 1,
        working_version: newWorkingVersion,
        created_at: db.serverDate(),
        updated_at: db.serverDate(),
        published_at: null
      }
    })

    await replaceChildren(
      newId,
      openid,
      normalizeMedia(source.media),
      normalizeCustomItems(source.custom_items, false),
      { scope: 'working', publicationId: newWorkingVersion }
    )
    return getCompositeForOwner(newId, openid)
  } catch (error) {
    try {
      await removeAllByArchive(mediaCollection, newId)
      await removeAllByArchive(customCollection, newId)
      await archives.doc(newId).remove()
    } catch (cleanupError) {
      console.error('[archiveService] copy rollback', newId, cleanupError)
    }
    throw error
  }
}

async function deleteComposite(id, openid) {
  const existing = await getOwnedArchive(id, openid)
  const publishedVersion = cleanText(existing.published_version)
  const publicSnapshot = existing.published_snapshot
    ? normalizeRoot(existing.published_snapshot)
    : (existing.status === 'published' ? normalizeRoot(existing) : null)
  const publishedMediaRows = publishedVersion
    ? publishedRows(await getAllByArchive(mediaCollection, id), publishedVersion)
    : []
  const publishedFileIds = publishedFileIdsFromVersion(publicSnapshot, publishedMediaRows)
  const qrCodeFileId = cleanText(existing.qr_code_file_id)
  // 先进入 deleting 状态，立即关闭公开读取；保留发布指针，便于删除失败后重试清理文件。
  await archives.doc(id).update({
    data: {
      status: 'draft',
      save_state: 'deleting',
      public_status: 'none',
      updated_at: db.serverDate()
    }
  })
  // 先清理只属于当前档案的发布副本；失败时保留主记录与指针，下一次删除可继续重试。
  await removeCloudFiles(publishedFileIds.concat(qrCodeFileId ? [qrCodeFileId] : []))
  await removeAllByArchive(mediaCollection, id)
  await removeAllByArchive(customCollection, id)
  await archives.doc(id).remove()
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
      case 'getQrCode':
        data = await generateArchiveQrCode(cleanText(event.id), OPENID)
        break
      case 'save':
        data = await saveComposite(event, OPENID)
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
