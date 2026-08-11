import { SECTIONS, createEmptySections, findMissingRequired } from '../../config/schema'
import { getArchive, saveArchive } from '../../utils/store'

function customId() {
  return 'cs_' + Math.random().toString(36).slice(2, 10)
}

Page({
  data: {
    SECTIONS,
    id: '',
    createdAt: 0,
    sections: createEmptySections(), // 新建时全空，不预填任何内容
    customSections: [],
    collapsed: {}, // 区块折叠状态，默认全部展开
    canSave: false
  },

  async onLoad(options) {
    const id = options.id || ''
    if (!id) {
      wx.setNavigationBarTitle({ title: '新建档案' })
      return
    }
    const archive = await getArchive(id)
    if (!archive) {
      wx.showToast({ title: '档案不存在', icon: 'none' })
      return
    }
    wx.setNavigationBarTitle({ title: '编辑档案' })
    this.setData({
      id: archive.id,
      createdAt: archive.createdAt,
      sections: archive.sections,
      customSections: archive.customSections,
      canSave: findMissingRequired(archive.sections).length === 0
    })
  },

  refreshCanSave() {
    this.setData({ canSave: findMissingRequired(this.data.sections).length === 0 })
  },

  onToggleSection(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ [`collapsed.${key}`]: !this.data.collapsed[key] })
  },

  onFieldInput(e) {
    const { section, field } = e.currentTarget.dataset
    this.setData({ [`sections.${section}.${field}`]: e.detail.value })
    this.refreshCanSave()
  },

  onPickerChange(e) {
    const { section, field } = e.currentTarget.dataset
    const options = SECTIONS.find(s => s.key === section).fields.find(f => f.key === field).options
    this.setData({ [`sections.${section}.${field}`]: options[e.detail.value] })
    this.refreshCanSave()
  },

  onImageAdd(e) {
    const { section, field } = e.currentTarget.dataset
    wx.chooseMedia({
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: res => {
        // TODO: 接入云存储后改成 wx.cloud.uploadFile，这里存 fileID 而不是本地临时路径。
        // 本地临时路径在开发者工具重启后会失效，属于本地阶段的已知限制。
        const added = res.tempFiles.map(file => file.tempFilePath)
        const current = this.data.sections[section][field] || []
        this.setData({ [`sections.${section}.${field}`]: current.concat(added) })
      }
    })
  },

  onImageDelete(e) {
    const { section, field, index } = e.currentTarget.dataset
    const current = (this.data.sections[section][field] || []).slice()
    current.splice(index, 1)
    this.setData({ [`sections.${section}.${field}`]: current })
  },

  onCustomAdd() {
    this.setData({
      customSections: this.data.customSections.concat([{ id: customId(), title: '', content: '' }])
    })
  },

  onCustomRemove(e) {
    const list = this.data.customSections.slice()
    list.splice(e.currentTarget.dataset.index, 1)
    this.setData({ customSections: list })
  },

  onCustomTitleInput(e) {
    this.setData({ [`customSections[${e.currentTarget.dataset.index}].title`]: e.detail.value })
  },

  onCustomContentInput(e) {
    this.setData({ [`customSections[${e.currentTarget.dataset.index}].content`]: e.detail.value })
  },

  async onSave() {
    const missing = findMissingRequired(this.data.sections)
    if (missing.length > 0) {
      wx.showToast({ title: `请填写${missing.join('、')}`, icon: 'none' })
      return
    }
    const saved = await saveArchive({
      id: this.data.id,
      createdAt: this.data.createdAt,
      sections: this.data.sections,
      customSections: this.data.customSections
    })
    wx.redirectTo({ url: `/pages/qrcode/qrcode?id=${saved.id}` })
  }
})
