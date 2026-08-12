import { SECTIONS } from '../../config/schema'
import { getArchive } from '../../utils/store'

function hasValue(field, value) {
  if (field.type === 'media') return Array.isArray(value) && value.length > 0
  return value !== undefined && value !== null && String(value).trim() !== ''
}

function getDisplaySections(sections) {
  return SECTIONS.filter(section => section.key !== 'basic').map(section => {
    const values = sections[section.key] || {}
    const fields = section.fields
      .filter(field => hasValue(field, values[field.key]))
      .map(field => ({ ...field, value: values[field.key] }))
    return {
      ...section,
      empty: fields.length === 0,
      fields
    }
  })
}

function getArchiveId(options) {
  // 普通页面路径使用 id；未来接入 getUnlimited 小程序码后，微信会把码参数放在 scene。
  const raw = options.scene || options.id || ''
  try {
    return decodeURIComponent(raw).replace(/^id=/, '')
  } catch (error) {
    return ''
  }
}

Page({
  data: {
    SECTIONS,
    loaded: false,
    found: false,
    headerName: '',
    headerCategory: '',
    coverImage: '',
    summary: '',
    productCode: '',
    displaySections: [],
    customSections: [],
    expanded: {}
  },

  async onLoad(options) {
    const archive = await getArchive(getArchiveId(options))
    if (!archive || archive.status !== 'published') {
      this.setData({ loaded: true, found: false })
      return
    }
    this.setData({
      loaded: true,
      found: true,
      // 顶部标题是本页唯一直接引用具体字段的地方，其余全部按 schema 渲染。
      headerName: archive.sections.basic.name,
      headerCategory: archive.sections.basic.category,
      coverImage: archive.sections.basic.coverImage,
      summary: archive.sections.basic.summary,
      productCode: archive.sections.basic.code,
      displaySections: getDisplaySections(archive.sections),
      // 内容为空的自定义区块整块不显示
      customSections: archive.customSections
        .filter(item => item.content && item.content.trim())
        .map(item => ({ ...item, key: `custom-${item.id}` }))
    })
    wx.setNavigationBarTitle({ title: archive.name || '茶叶档案' })
  },

  onToggleSection(e) {
    const { key, empty } = e.currentTarget.dataset
    if (empty) return
    this.setData({ [`expanded.${key}`]: !this.data.expanded[key] })
  },

  onPreviewImage(e) {
    const current = e.currentTarget.dataset.current
    if (!current) return
    wx.previewImage({ current, urls: [current] })
  }
})
