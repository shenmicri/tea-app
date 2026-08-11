/**
 * 数据层。页面只通过这里读写数据。
 * 现阶段用 wx.*StorageSync 当数据库；将来换成云数据库时只改本文件，页面代码不动。
 * 因此所有导出函数都写成 async，尽管现在内部是同步的。
 */

import { SECTIONS, createEmptySections } from '../config/schema'

const STORAGE_KEY = 'tea_archives'

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

/**
 * 用当前 schema 补齐一份档案：schema 里新增的字段补空值，旧数据里多余的键原样保留但不渲染。
 * 有了它，schema 改动后老档案也能正常打开。
 */
function applySchema(archive) {
  if (!archive) return null
  const sections = archive.sections || {}
  const filled = createEmptySections()
  SECTIONS.forEach(section => {
    const saved = sections[section.key] || {}
    Object.keys(saved).forEach(key => {
      if (saved[key] !== undefined && saved[key] !== null) filled[section.key][key] = saved[key]
    })
  })
  return {
    id: archive.id,
    name: archive.name || '',
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

/** 按 id 删除。 */
export async function deleteArchive(id) {
  writeAll(readAll().filter(item => item.id !== id))
}
