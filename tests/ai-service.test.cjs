const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { EventEmitter } = require('node:events')
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

function historyId(openid, archiveId) {
  const digest = crypto.createHash('sha256').update(`${openid}:${archiveId}`).digest('hex').slice(0, 32)
  return `history_${digest}`
}

function createCloudMock() {
  const openid = 'viewer-a'
  const archiveId = 'archive1'
  const tables = new Map([
    ['tea_archives', new Map([[
      `${archiveId}_published`,
      {
        _id: `${archiveId}_published`,
        archive_id: archiveId,
        record_type: 'published',
        status: 'published',
        tea_name: '白牡丹',
        tea_type: '白茶',
        cover_image_file_id: 'cloud://private/cover.jpg',
        product_summary: '花香清雅，滋味清甜。',
        tea_profile: '芽叶连枝，银毫披覆。',
        brewing_storage_notes: '建议使用盖碗冲泡。',
        contact_info: '示例联系信息'
      }
    ]])],
    ['archive_custom_items', new Map([[
      'custom-one',
      {
        _id: 'custom-one',
        archive_id: archiveId,
        record_type: 'published',
        custom_item_id: 'award',
        title: '获奖记录',
        content: '春季茶会金奖',
        sort_order: 1
      }
    ]])],
    ['archive_view_history', new Map([[
      historyId(openid, archiveId),
      {
        _id: historyId(openid, archiveId),
        owner_openid: openid,
        archive_id: archiveId,
        last_viewed_at: new Date()
      }
    ]])]
  ])
  const safetyCalls = []

  const matches = (row, condition) => Object.entries(condition || {}).every(([key, value]) => row[key] === value)
  function collection(name) {
    const rows = tables.get(name)
    if (!rows) throw new Error(`unknown collection: ${name}`)
    const query = (condition, offset = 0, maximum = Infinity) => ({
      skip(value) { return query(condition, value, maximum) },
      limit(value) { return query(condition, offset, value) },
      async get() {
        return {
          data: Array.from(rows.values())
            .filter(row => matches(row, condition))
            .slice(offset, offset + maximum)
            .map(clone)
        }
      }
    })
    return {
      doc(id) {
        return {
          async get() {
            if (!rows.has(id)) throw new Error('document does not exist')
            return { data: clone(rows.get(id)) }
          }
        }
      },
      where(condition) { return query(condition) }
    }
  }
  return {
    DYNAMIC_CURRENT_ENV: 'dynamic-current-env',
    init() {},
    database() { return { collection } },
    getWXContext() { return { OPENID: openid } },
    openapi: {
      security: {
        async msgSecCheck(options) {
          safetyCalls.push(clone(options))
          return { errCode: 0, result: { suggest: 'pass', label: 100 } }
        }
      }
    },
    __safetyCalls: safetyCalls
  }
}

function createHttpsMock() {
  const calls = []
  return {
    calls,
    request(options, callback) {
      const request = new EventEmitter()
      const chunks = []
      request.setTimeout = () => {}
      request.write = chunk => { chunks.push(Buffer.from(chunk)) }
      request.destroy = error => { request.emit('error', error) }
      request.end = () => {
        calls.push({ options: clone(options), body: Buffer.concat(chunks).toString('utf8') })
        const response = new EventEmitter()
        response.statusCode = 200
        callback(response)
        process.nextTick(() => {
          response.emit('data', Buffer.from(JSON.stringify({
            choices: [{ message: { content: '白牡丹档案描述了花香与清甜滋味。' } }]
          })))
          response.emit('end')
        })
      }
      return request
    }
  }
}

function loadService(cloud, httpsMock) {
  const originalLoad = Module._load
  Module._load = function load(request, parent, isMain) {
    if (request === 'wx-server-sdk') return cloud
    if (request === 'https') return httpsMock
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const servicePath = path.join(process.cwd(), 'cloudfunctions/teaAi/index.js')
    delete require.cache[require.resolve(servicePath)]
    return require(servicePath)
  } finally {
    Module._load = originalLoad
  }
}

async function run() {
  const previousKey = process.env.DEEPSEEK_API_KEY
  process.env.DEEPSEEK_API_KEY = 'test-key-from-environment'
  try {
    const cloud = createCloudMock()
    const httpsMock = createHttpsMock()
    const service = loadService(cloud, httpsMock)
    const result = await service.main({
      action: 'chat',
      archiveIds: ['archive1'],
      messages: [{ role: 'user', content: '请总结这份茶叶档案' }]
    })
    assert.equal(result.ok, true)
    assert.equal(result.data.answer, '白牡丹档案描述了花香与清甜滋味。')
    assert.equal(result.data.archiveCount, 1)
    assert.equal(httpsMock.calls.length, 1)
    const providerCall = httpsMock.calls[0]
    assert.equal(providerCall.options.hostname, 'api.deepseek.com')
    assert.equal(providerCall.options.path, '/chat/completions')
    assert.equal(providerCall.options.headers.Authorization, 'Bearer test-key-from-environment')
    const body = JSON.parse(providerCall.body)
    assert.equal(body.model, 'deepseek-v4-flash')
    assert.equal(body.stream, false)
    assert.deepEqual(body.thinking, { type: 'disabled' })
    assert.equal(body.messages[0].content, '你是一个资深的茶业人员。')
    const serializedMessages = JSON.stringify(body.messages)
    for (const expected of ['白牡丹', '白茶', '花香清雅', '盖碗冲泡', '获奖记录', '春季茶会金奖']) {
      assert.ok(serializedMessages.includes(expected), `published text must be sent: ${expected}`)
    }
    assert.ok(serializedMessages.includes('仅使用我提供的茶叶信息进行回答'))
    assert.ok(serializedMessages.includes('不允许联网搜索其他茶叶信息'))
    assert.ok(!serializedMessages.includes('cloud://private/cover.jpg'))
    assert.ok(!serializedMessages.includes('cover_image_file_id'))
    assert.equal(cloud.__safetyCalls.length, 2, 'user question and AI answer must both be checked')

    const tooMany = await service.main({
      action: 'chat',
      archiveIds: ['1', '2', '3', '4', '5', '6'],
      messages: [{ role: 'user', content: '比较' }]
    })
    assert.equal(tooMany.ok, false)
    assert.equal(tooMany.error.code, 'AI_ARCHIVE_LIMIT')

    const source = fs.readFileSync(path.join(process.cwd(), 'cloudfunctions/teaAi/index.js'), 'utf8')
    assert.equal(/sk-[a-z0-9]{16,}/i.test(source), false, 'API keys must never be committed to source')
    console.log('passed: teaAi uses selected published text, fixed prompts, non-stream DeepSeek, and no media')
  } finally {
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = previousKey
  }
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
