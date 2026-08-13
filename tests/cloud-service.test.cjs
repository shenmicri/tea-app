const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')

function clone(value) {
  if (value instanceof Date) return new Date(value.getTime())
  if (Array.isArray(value)) return value.map(clone)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]))
  }
  return value
}

function createCloudMock() {
  const tables = new Map([
    ['tea_archives', new Map()],
    ['archive_media', new Map()],
    ['archive_custom_items', new Map()]
  ])
  let openid = 'owner-a'
  let clock = Date.parse('2026-08-13T12:00:00Z')
  let automaticId = 0
  const securityCalls = {
    msg: [],
    img: [],
    mediaAsync: [],
    download: [],
    upload: [],
    delete: [],
    qr: []
  }
  let msgSecCheckHandler = async () => ({
    errCode: 0,
    errMsg: 'ok',
    result: { suggest: 'pass', label: 100 }
  })
  let imgSecCheckHandler = async () => ({ errCode: 0, errMsg: 'ok' })
  let downloadFileHandler = async () => ({
    fileContent: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])
  })

  const SET_COMMAND = Symbol('set-command')
  const applyUpdate = (current, data) => Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      value && value[SET_COMMAND] ? clone(value.value) : clone(value)
    ])
  )

  const matches = (row, condition) => Object.entries(condition || {})
    .every(([key, value]) => row[key] === value)

  function collection(name) {
    const rows = tables.get(name)
    if (!rows) throw new Error(`unknown collection: ${name}`)

    const document = id => ({
      async get() {
        if (!rows.has(id)) throw new Error('document does not exist')
        return { data: clone(rows.get(id)) }
      },
      async update({ data }) {
        if (!rows.has(id)) return { stats: { updated: 0 } }
        rows.set(id, { ...rows.get(id), ...applyUpdate(rows.get(id), data), _id: id })
        return { stats: { updated: 1 } }
      },
      async remove() {
        return { stats: { removed: rows.delete(id) ? 1 : 0 } }
      }
    })

    const query = (condition, offset = 0, maximum = Infinity) => ({
      skip(value) { return query(condition, value, maximum) },
      limit(value) { return query(condition, offset, value) },
      async get() {
        const data = Array.from(rows.values())
          .filter(row => matches(row, condition))
          .slice(offset, offset + maximum)
          .map(clone)
        return { data }
      },
      async update({ data }) {
        const selected = Array.from(rows.values()).filter(row => matches(row, condition))
        selected.forEach(row => rows.set(row._id, {
          ...row,
          ...applyUpdate(row, data),
          _id: row._id
        }))
        return { stats: { updated: selected.length } }
      }
    })

    return {
      doc: document,
      where(condition) { return query(condition) },
      async add({ data }) {
        const id = data._id || `auto-${++automaticId}`
        if (rows.has(id)) throw new Error('duplicate document id')
        rows.set(id, { ...clone(data), _id: id })
        return { _id: id }
      }
    }
  }

  const cloud = {
    DYNAMIC_CURRENT_ENV: 'dynamic-current-env',
    init() {},
    database() {
      return {
        collection,
        command: {
          set(value) {
            return { [SET_COMMAND]: true, value }
          }
        },
        serverDate() {
          clock += 1000
          return new Date(clock)
        }
      }
    },
    getWXContext() { return { OPENID: openid } },
    openapi: {
      security: {
        async msgSecCheck(options) {
          securityCalls.msg.push(clone(options))
          return msgSecCheckHandler(options)
        },
        async imgSecCheck(options) {
          const media = options && options.media
          securityCalls.img.push({
            ...clone(options),
            media: media && {
              ...clone(media),
              value: Buffer.isBuffer(media.value) ? Buffer.from(media.value) : media.value
            }
          })
          return imgSecCheckHandler(options)
        },
        async mediaCheckAsync(options) {
          securityCalls.mediaAsync.push(clone(options))
          throw new Error('security.mediaCheckAsync must not be used')
        }
      },
      wxacode: {
        async getUnlimited(options) {
          securityCalls.qr.push(clone(options))
          return {
            errCode: 0,
            errMsg: 'ok',
            contentType: 'image/jpeg',
            buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0])
          }
        }
      }
    },
    async downloadFile(options) {
      securityCalls.download.push(clone(options))
      return downloadFileHandler(options)
    },
    async uploadFile(options) {
      securityCalls.upload.push({
        ...clone(options),
        fileContent: Buffer.isBuffer(options.fileContent)
          ? Buffer.from(options.fileContent)
          : options.fileContent
      })
      return { fileID: `cloud://env-id/${options.cloudPath}` }
    },
    async deleteFile({ fileList }) {
      securityCalls.delete.push(fileList.slice())
      return {
        fileList: fileList.map(fileID => ({ fileID, status: 0, errMsg: 'ok' }))
      }
    },
    async getTempFileURL({ fileList }) {
      return {
        fileList: fileList.map(fileID => ({
          fileID,
          status: 0,
          tempFileURL: `https://temp.test/${encodeURIComponent(fileID)}`
        }))
      }
    },
    __setOpenId(value) { openid = value },
    __table(name) { return tables.get(name) },
    __security: {
      calls: securityCalls,
      resetCalls() {
        Object.values(securityCalls).forEach(items => { items.length = 0 })
      },
      resetHandlers() {
        msgSecCheckHandler = async () => ({
          errCode: 0,
          errMsg: 'ok',
          result: { suggest: 'pass', label: 100 }
        })
        imgSecCheckHandler = async () => ({ errCode: 0, errMsg: 'ok' })
        downloadFileHandler = async () => ({
          fileContent: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])
        })
      },
      setMsgHandler(handler) { msgSecCheckHandler = handler },
      setImgHandler(handler) { imgSecCheckHandler = handler },
      setDownloadHandler(handler) { downloadFileHandler = handler }
    }
  }
  return cloud
}

function loadService(cloud) {
  const originalLoad = Module._load
  Module._load = function load(request, parent, isMain) {
    if (request === 'wx-server-sdk') return cloud
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const servicePath = path.join(process.cwd(), 'cloudfunctions/archiveService/index.js')
    delete require.cache[require.resolve(servicePath)]
    return require(servicePath)
  } finally {
    Module._load = originalLoad
  }
}

function securityCallCount(cloud) {
  const calls = cloud.__security.calls
  return calls.msg.length + calls.img.length + calls.mediaAsync.length +
    calls.download.length + calls.upload.length
}

function snapshotArchiveTables(cloud, archiveId) {
  const names = ['tea_archives', 'archive_media', 'archive_custom_items']
  return Object.fromEntries(names.map(name => [
    name,
    Array.from(cloud.__table(name).values())
      .filter(row => name === 'tea_archives' ? row._id === archiveId : row.archive_id === archiveId)
      .sort((left, right) => String(left._id).localeCompare(String(right._id)))
      .map(clone)
  ]))
}

async function assertRejectedWithoutWrites({
  call,
  cloud,
  event,
  code,
  message
}) {
  const archiveId = event.archive.id
  const before = snapshotArchiveTables(cloud, archiveId)
  const uploadCountBefore = cloud.__security.calls.upload.length
  const result = await call(event)
  assert.equal(result.ok, false, message)
  assert.equal(result.error.code, code, message)
  assert.deepEqual(
    snapshotArchiveTables(cloud, archiveId),
    before,
    `${message}: a rejected publish must not mutate any of the three collections`
  )
  assert.equal(
    cloud.__security.calls.upload.length,
    uploadCountBefore,
    `${message}: a rejected publish must not upload a published media copy`
  )
  return result
}

function assertSecurityPermissions() {
  const configPath = path.join(process.cwd(), 'cloudfunctions/archiveService/config.json')
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const permissions = (config.permissions && config.permissions.openapi) || []
  assert.ok(permissions.includes('security.msgSecCheck'))
  assert.ok(permissions.includes('security.imgSecCheck'))
  assert.ok(permissions.includes('wxacode.getUnlimited'))
  assert.ok(!permissions.includes('security.mediaCheckAsync'))
}

async function run() {
  assertSecurityPermissions()
  const previousEnvironment = process.env.TCB_ENV
  process.env.TCB_ENV = 'env-id'
  const cloud = createCloudMock()
  const service = loadService(cloud)
  const call = event => service.main(event)

  try {
    const started = await call({ action: 'startDraft' })
    assert.equal(started.ok, true)
    const { id, upload_token: uploadToken } = started.data
    assert.equal(started.data.revision, 0)

    const beforeFirstSave = await call({ action: 'listMine' })
    assert.deepEqual(beforeFirstSave.data, [], 'reserved drafts must stay out of listMine')

    const incompleteRoot = { tea_name: '待完善白茶' }
    const incompleteSave = await call({
      action: 'save',
      archive: {
        id,
        revision: 0,
        status: 'draft',
        root: incompleteRoot,
        media: [],
        custom_items: []
      }
    })
    assert.equal(incompleteSave.ok, true, 'incomplete drafts may be saved')
    assert.equal(incompleteSave.data.root.status, 'draft')
    assert.equal(incompleteSave.data.root.revision, 1)
    assert.equal((await call({ action: 'listMine' })).data.length, 1)
    assert.equal(securityCallCount(cloud), 0, 'saving a draft must not run content checks')

    const invalidPublish = await call({
      action: 'save',
      archive: {
        id,
        revision: 1,
        status: 'published',
        root: incompleteRoot,
        media: [],
        custom_items: []
      }
    })
    assert.equal(invalidPublish.ok, false)
    assert.equal(invalidPublish.error.code, 'PUBLISH_REQUIRED')
    assert.equal(securityCallCount(cloud), 0, 'required-field validation must run before content checks')
    const draftQr = await call({ action: 'getQrCode', id })
    assert.equal(draftQr.ok, false)
    assert.equal(draftQr.error.code, 'QR_ARCHIVE_NOT_PUBLISHED')

    const file = name => `cloud://env-id/tea-archives/${uploadToken}/${name}`
    const publishedRoot = {
      tea_name: '白牡丹',
      tea_type: '白茶',
      cover_image_file_id: file('cover.jpg'),
      product_summary: '花香清雅，滋味清甜。',
      tea_profile: '芽叶连枝。'
    }
    const publishedMedia = [{
      media_id: 'detail-1',
      section_key: 'feature',
      media_type: 'image',
      file_id: file('detail.jpg'),
      sort_order: 1
    }]
    const publishedCustom = [{
      custom_item_id: 'award-1',
      title: '获奖记录',
      content: '春季茶会金奖'
    }]
    cloud.__security.resetCalls()
    const published = await call({
      action: 'save',
      archive: {
        id,
        revision: 1,
        status: 'published',
        root: publishedRoot,
        media: publishedMedia,
        custom_items: publishedCustom
      }
    })
    assert.equal(published.ok, true)
    assert.equal(published.data.root.revision, 2)
    assert.ok(cloud.__security.calls.msg.length > 0, 'publishing must check text')
    cloud.__security.calls.msg.forEach(options => {
      assert.equal(options.version, 2)
      assert.equal(options.scene, 1)
      assert.equal(options.openid, 'owner-a')
    })
    const checkedText = cloud.__security.calls.msg.map(options => options.content).join('\n')
    for (const text of [
      publishedRoot.tea_name,
      publishedRoot.tea_type,
      publishedRoot.product_summary,
      publishedRoot.tea_profile,
      publishedCustom[0].title,
      publishedCustom[0].content
    ]) {
      assert.ok(checkedText.includes(text), `published text must be checked: ${text}`)
    }
    assert.equal(cloud.__security.calls.download.length, 2, 'cover and detail image must be downloaded')
    assert.equal(cloud.__security.calls.img.length, 2, 'cover and detail image must be checked')
    cloud.__security.calls.img.forEach(options => {
      assert.ok(Buffer.isBuffer(options.media.value), 'imgSecCheck must receive a Buffer')
      assert.match(options.media.contentType, /^image\//)
    })
    assert.equal(cloud.__security.calls.mediaAsync.length, 0)
    assert.equal(cloud.__security.calls.upload.length, 2, 'checked cover and detail image need published copies')
    cloud.__security.calls.upload.forEach(options => {
      assert.match(options.cloudPath, /^tea-archives-published\//)
      assert.ok(Buffer.isBuffer(options.fileContent), 'published copies must use the checked image Buffer')
    })

    const firstPublic = await call({ action: 'getPublicArchive', id })
    assert.equal(firstPublic.ok, true)
    assert.equal(firstPublic.data.root.tea_name, '白牡丹')
    assert.match(
      decodeURIComponent(firstPublic.data.root.cover_image_file_id),
      /cloud:\/\/env-id\/tea-archives-published\//,
      'public cover must resolve from the server-side published copy'
    )
    assert.equal(firstPublic.data.media.length, 1)
    assert.match(
      decodeURIComponent(firstPublic.data.media[0].file_id),
      /cloud:\/\/env-id\/tea-archives-published\//,
      'public detail image must resolve from the server-side published copy'
    )
    assert.equal(firstPublic.data.custom_items[0].title, '获奖记录')

    const uploadsBeforeQr = cloud.__security.calls.upload.length
    const firstQr = await call({ action: 'getQrCode', id })
    assert.equal(firstQr.ok, true)
    assert.match(firstQr.data.file_id, /tea-archives-published\/codes\//)
    assert.equal(firstQr.data.mime_type, 'image/jpeg')
    assert.equal(firstQr.data.file_base64, Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString('base64'))
    assert.equal(cloud.__security.calls.qr.length, 1)
    assert.equal(cloud.__security.calls.qr[0].scene, id)
    assert.equal(cloud.__security.calls.qr[0].page, 'pages/archive/archive')
    assert.equal(cloud.__security.calls.qr[0].envVersion, 'release')
    assert.equal(cloud.__security.calls.upload.length, uploadsBeforeQr + 1)

    const cachedQr = await call({ action: 'getQrCode', id })
    assert.equal(cachedQr.ok, true)
    assert.equal(cachedQr.data.file_id, firstQr.data.file_id)
    assert.ok(cachedQr.data.file_base64, 'cached qr code must return reusable image data')
    assert.equal(cloud.__security.calls.qr.length, 1, 'cached qr code must not be regenerated')

    const draftRoot = { ...publishedRoot, tea_name: '白牡丹·修改中' }
    const draftMedia = [{
      ...publishedMedia[0],
      file_id: file('draft-detail.jpg')
    }]
    const draftCustom = [{
      ...publishedCustom[0],
      content: '尚未公开的新说明'
    }]
    cloud.__security.resetCalls()
    cloud.__security.setMsgHandler(async () => { throw new Error('draft text must not be checked') })
    cloud.__security.setImgHandler(async () => { throw new Error('draft image must not be checked') })
    const draftSave = await call({
      action: 'save',
      archive: {
        id,
        revision: 2,
        status: 'draft',
        root: draftRoot,
        media: draftMedia,
        custom_items: draftCustom
      }
    })
    assert.equal(draftSave.ok, true)
    assert.equal(draftSave.data.root.status, 'draft')
    assert.equal(draftSave.data.root.public_status, 'published')
    assert.equal(securityCallCount(cloud), 0, 'saving edits as a draft must not run content checks')
    cloud.__security.resetHandlers()

    const publicAfterDraft = await call({ action: 'getPublicArchive', id })
    assert.equal(publicAfterDraft.ok, true)
    assert.equal(publicAfterDraft.data.root.tea_name, '白牡丹', 'draft must not replace public root')
    assert.equal(publicAfterDraft.data.custom_items[0].content, '春季茶会金奖')
    assert.equal(
      publicAfterDraft.data.root.cover_image_file_id,
      firstPublic.data.root.cover_image_file_id,
      'draft must retain the previous published cover copy'
    )
    assert.equal(
      publicAfterDraft.data.media[0].file_id,
      firstPublic.data.media[0].file_id,
      'draft must retain the previous published detail copy'
    )

    const firstPublishedFileIds = [
      decodeURIComponent(firstPublic.data.root.cover_image_file_id),
      decodeURIComponent(firstPublic.data.media[0].file_id)
    ].map(value => value.slice(value.indexOf('cloud://')))

    const publishEditedArchive = () => ({
      action: 'save',
      archive: {
        id,
        revision: 3,
        status: 'published',
        root: draftRoot,
        media: draftMedia,
        custom_items: draftCustom
      }
    })

    for (const suggest of ['risky', 'review']) {
      cloud.__security.resetCalls()
      cloud.__security.resetHandlers()
      cloud.__security.setMsgHandler(async () => ({
        errCode: 0,
        errMsg: 'ok',
        result: { suggest, label: 20001 }
      }))
      await assertRejectedWithoutWrites({
        call,
        cloud,
        event: publishEditedArchive(),
        code: 'TEXT_CONTENT_RISKY',
        message: `text moderation suggestion ${suggest} must block publishing`
      })
      assert.ok(cloud.__security.calls.msg.length > 0)
      assert.equal(cloud.__security.calls.img.length, 0, 'risky text must stop before image checks')
      assert.equal(cloud.__security.calls.mediaAsync.length, 0)
    }

    cloud.__security.resetCalls()
    cloud.__security.resetHandlers()
    cloud.__security.setMsgHandler(async () => { throw new Error('msg check timeout') })
    await assertRejectedWithoutWrites({
      call,
      cloud,
      event: publishEditedArchive(),
      code: 'CONTENT_CHECK_UNAVAILABLE',
      message: 'a msgSecCheck API failure must fail closed'
    })
    assert.equal(cloud.__security.calls.img.length, 0)

    cloud.__security.resetCalls()
    cloud.__security.resetHandlers()
    cloud.__security.setImgHandler(async () => {
      throw Object.assign(new Error('risky content'), { errCode: 87014 })
    })
    await assertRejectedWithoutWrites({
      call,
      cloud,
      event: publishEditedArchive(),
      code: 'IMAGE_CONTENT_RISKY',
      message: 'imgSecCheck error 87014 must block publishing'
    })
    assert.ok(cloud.__security.calls.img.length > 0)
    assert.equal(cloud.__security.calls.mediaAsync.length, 0)

    cloud.__security.resetCalls()
    cloud.__security.resetHandlers()
    cloud.__security.setImgHandler(async () => ({ errCode: 87014, errMsg: 'risky content' }))
    await assertRejectedWithoutWrites({
      call,
      cloud,
      event: publishEditedArchive(),
      code: 'IMAGE_CONTENT_RISKY',
      message: 'a returned imgSecCheck code 87014 must block publishing'
    })

    cloud.__security.resetCalls()
    cloud.__security.resetHandlers()
    cloud.__security.setImgHandler(async () => { throw new Error('img check timeout') })
    await assertRejectedWithoutWrites({
      call,
      cloud,
      event: publishEditedArchive(),
      code: 'CONTENT_CHECK_UNAVAILABLE',
      message: 'an imgSecCheck API failure must fail closed'
    })

    cloud.__security.resetCalls()
    cloud.__security.resetHandlers()
    const videoDraftStart = await call({ action: 'startDraft' })
    const videoDraftFile = name => (
      `cloud://env-id/tea-archives/${videoDraftStart.data.upload_token}/${name}`
    )
    const videoDraftRoot = {
      ...draftRoot,
      cover_image_file_id: videoDraftFile('cover.jpg')
    }
    const videoDraftMedia = [{
      media_id: 'video-1',
      section_key: 'feature',
      media_type: 'video',
      file_id: videoDraftFile('introduction.mp4'),
      poster_file_id: videoDraftFile('introduction-poster.jpg'),
      sort_order: 1
    }]
    const videoDraft = await call({
      action: 'save',
      archive: {
        id: videoDraftStart.data.id,
        revision: 0,
        status: 'draft',
        root: videoDraftRoot,
        media: videoDraftMedia,
        custom_items: draftCustom
      }
    })
    assert.equal(videoDraft.ok, true, 'videos may still be retained in drafts')
    assert.equal(securityCallCount(cloud), 0, 'a video draft must not run or stage content checks')

    cloud.__security.resetCalls()
    cloud.__security.resetHandlers()
    const publishedVideo = await call({
      action: 'save',
      archive: {
        id: videoDraftStart.data.id,
        revision: 1,
        status: 'published',
        root: videoDraftRoot,
        media: videoDraftMedia,
        custom_items: draftCustom
      }
    })
    assert.equal(publishedVideo.ok, true, 'videos may be published without video moderation')
    const checkedDownloads = cloud.__security.calls.download.map(options => options.fileID)
    assert.ok(checkedDownloads.includes(videoDraftRoot.cover_image_file_id), 'cover image is still checked')
    assert.ok(!checkedDownloads.includes(videoDraftMedia[0].file_id), 'video body must not be checked')
    assert.ok(!checkedDownloads.includes(videoDraftMedia[0].poster_file_id), 'video poster must not be checked')
    assert.equal(cloud.__security.calls.img.length, 1, 'only the required cover image is checked')
    assert.equal(cloud.__security.calls.mediaAsync.length, 0)
    const publicVideo = await call({ action: 'getPublicArchive', id: videoDraftStart.data.id })
    assert.equal(publicVideo.ok, true)
    assert.equal(publicVideo.data.media[0].media_type, 'video')
    assert.match(publicVideo.data.media[0].file_id, /^https:\/\/temp\.test\//)

    cloud.__security.resetCalls()
    cloud.__security.resetHandlers()
    const longTextStart = await call({ action: 'startDraft' })
    const longTextToken = longTextStart.data.upload_token
    const longTextFile = name => `cloud://env-id/tea-archives/${longTextToken}/${name}`
    const longTextValue = '春山白茶'.repeat(700)
    const longTextPublish = await call({
      action: 'save',
      archive: {
        id: longTextStart.data.id,
        revision: 0,
        status: 'published',
        root: {
          tea_name: '长文本测试茶',
          tea_type: '白茶',
          cover_image_file_id: longTextFile('cover.jpg'),
          product_summary: longTextValue
        },
        media: [],
        custom_items: []
      }
    })
    assert.equal(longTextPublish.ok, true)
    assert.ok(cloud.__security.calls.msg.length > 1, 'long text must be split into multiple checks')
    cloud.__security.calls.msg.forEach(options => {
      assert.ok(Array.from(options.content).length <= 2000, 'each msgSecCheck chunk must stay below the API limit')
    })
    assert.ok(
      cloud.__security.calls.msg.map(options => options.content).join('').includes(longTextValue),
      'text chunking must not omit content'
    )

    cloud.__security.resetCalls()
    cloud.__security.resetHandlers()
    const republished = await call({
      action: 'save',
      archive: {
        id,
        revision: 3,
        status: 'published',
        root: draftRoot,
        media: draftMedia,
        custom_items: draftCustom
      }
    })
    assert.equal(republished.ok, true)
    assert.ok(
      cloud.__security.calls.delete.flat().some(fileId => firstPublishedFileIds.includes(fileId)),
      're-publishing must clean the explicitly captured previous published image copies'
    )

    const copied = await call({ action: 'copy', id })
    assert.equal(copied.ok, true)
    const copiedId = copied.data.root._id
    assert.notEqual(copiedId, id)
    assert.equal(copied.data.root.status, 'draft')
    assert.equal(copied.data.root.public_status, 'none')
    assert.equal(copied.data.media.length, 1)
    assert.equal(copied.data.custom_items.length, 1)
    assert.match(copied.data.root.tea_name, /副本/)

    cloud.__setOpenId('owner-b')
    const forbidden = await call({ action: 'getForEdit', id })
    assert.equal(forbidden.ok, false)
    assert.equal(forbidden.error.code, 'FORBIDDEN')

    cloud.__setOpenId('owner-a')
    cloud.__security.resetCalls()
    const removed = await call({ action: 'delete', id })
    assert.equal(removed.ok, true)
    assert.equal(cloud.__table('tea_archives').has(id), false)
    for (const tableName of ['archive_media', 'archive_custom_items']) {
      const leftovers = Array.from(cloud.__table(tableName).values())
        .filter(row => row.archive_id === id)
      assert.equal(leftovers.length, 0, `${tableName} must be cascade-deleted`)
    }
    assert.equal(cloud.__table('tea_archives').has(copiedId), true, 'deleting source must retain copy')
    assert.ok(
      cloud.__security.calls.delete.flat().length > 0,
      'deleting an archive must clean its server-created published image copies'
    )
    const deletedPublic = await call({ action: 'getPublicArchive', id })
    assert.equal(deletedPublic.ok, false)
    assert.equal(deletedPublic.error.code, 'NOT_FOUND')

    console.log('passed: archiveService in-memory three-table CRUD lifecycle')
  } finally {
    if (previousEnvironment === undefined) delete process.env.TCB_ENV
    else process.env.TCB_ENV = previousEnvironment
  }
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
