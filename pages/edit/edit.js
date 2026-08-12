import { SECTIONS, createEmptySections, findMissingRequired } from '../../config/schema'
import { getArchive, saveArchive } from '../../utils/store'

function customId() {
  return 'cs_' + Math.random().toString(36).slice(2, 10)
}

function mediaId() {
  return 'media_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7)
}

function persistLocalFile(tempFilePath) {
  if (!tempFilePath) return Promise.resolve('')
  return new Promise((resolve, reject) => {
    wx.saveFile({
      tempFilePath,
      success: res => resolve(res.savedFilePath),
      fail: reject
    })
  })
}

Page({
  data: {
    SECTIONS,
    id: '',
    createdAt: 0,
    status: 'draft',
    sections: createEmptySections(), // 新建时全空，不预填任何内容
    customSections: [],
    collapsed: {}, // 区块折叠状态，默认全部展开
    canGenerate: false,
    saving: false
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
      status: archive.status,
      sections: archive.sections,
      customSections: archive.customSections,
      canGenerate: findMissingRequired(archive.sections).length === 0
    })
  },

  refreshCanGenerate() {
    this.setData({ canGenerate: findMissingRequired(this.data.sections).length === 0 })
  },

  onToggleSection(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ [`collapsed.${key}`]: !this.data.collapsed[key] })
  },

  onSaveBarTap() {},

  onFieldInput(e) {
    const { section, field } = e.currentTarget.dataset
    this.setData({ [`sections.${section}.${field}`]: e.detail.value }, () => {
      this.refreshCanGenerate()
    })
  },

  onPickerChange(e) {
    const { section, field } = e.currentTarget.dataset
    const options = SECTIONS.find(s => s.key === section).fields.find(f => f.key === field).options
    this.setData({ [`sections.${section}.${field}`]: options[e.detail.value] }, () => {
      this.refreshCanGenerate()
    })
  },

  onCoverAdd(e) {
    const { section, field } = e.currentTarget.dataset
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: async res => {
        const file = res.tempFiles[0]
        if (file) {
          wx.showLoading({ title: '正在保存图片' })
          try {
            const savedPath = await persistLocalFile(file.tempFilePath)
            this.setData({ [`sections.${section}.${field}`]: savedPath }, () => {
              this.refreshCanGenerate()
            })
          } catch (error) {
            wx.showToast({ title: '图片保存失败，请重试', icon: 'none' })
          } finally {
            wx.hideLoading()
          }
        }
      }
    })
  },

  onCoverDelete(e) {
    const { section, field } = e.currentTarget.dataset
    this.setData({ [`sections.${section}.${field}`]: '' }, () => {
      this.refreshCanGenerate()
    })
  },

  onMediaAdd(e) {
    const { section, field } = e.currentTarget.dataset
    wx.showActionSheet({
      itemList: ['添加图片', '添加视频'],
      success: choice => {
        const isVideo = choice.tapIndex === 1
        wx.chooseMedia({
          count: isVideo ? 1 : 9,
          mediaType: [isVideo ? 'video' : 'image'],
          sourceType: ['album', 'camera'],
          maxDuration: 60,
          success: async res => {
            // TODO: 接入云存储后改成 wx.cloud.uploadFile，这里存 fileID 而不是本地临时路径。
            // 本地临时路径在开发者工具重启后会失效，属于本地阶段的已知限制。
            wx.showLoading({ title: '正在保存媒体' })
            try {
              const added = await Promise.all(res.tempFiles.map(async file => {
                const path = await persistLocalFile(file.tempFilePath)
                let poster = ''
                if (file.thumbTempFilePath) {
                  try {
                    poster = await persistLocalFile(file.thumbTempFilePath)
                  } catch (error) {
                    poster = ''
                  }
                }
                return {
                  id: mediaId(),
                  type: isVideo ? 'video' : 'image',
                  path,
                  poster,
                  duration: Math.round(Number(file.duration) || 0)
                }
              }))
              const current = this.data.sections[section][field] || []
              this.setData({ [`sections.${section}.${field}`]: current.concat(added) })
            } catch (error) {
              wx.showToast({ title: '媒体保存失败，请重试', icon: 'none' })
            } finally {
              wx.hideLoading()
            }
          }
        })
      }
    })
  },

  onMediaDelete(e) {
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

  async persist(status) {
    const saved = await saveArchive({
      id: this.data.id,
      createdAt: this.data.createdAt,
      status,
      sections: this.data.sections,
      customSections: this.data.customSections
    })
    this.setData({
      id: saved.id,
      createdAt: saved.createdAt,
      status: saved.status
    })
    wx.setNavigationBarTitle({ title: '编辑档案' })
    return saved
  },

  async onSaveDraft() {
    if (this.data.saving) return
    this.setData({ saving: true })
    wx.showLoading({ title: '正在保存' })
    try {
      await this.persist('draft')
      wx.hideLoading()
      wx.showToast({ title: '草稿已保存', icon: 'success' })
    } catch (error) {
      wx.hideLoading()
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },

  async onGenerate() {
    if (this.data.saving) return
    const missing = findMissingRequired(this.data.sections)
    if (missing.length > 0) {
      wx.showModal({
        title: '还不能生成档案',
        content: `请先补齐：${missing.join('、')}。当前内容仍可保存为草稿。`,
        showCancel: false,
        confirmText: '知道了'
      })
      return
    }
    this.setData({ saving: true })
    wx.showLoading({ title: '正在生成' })
    try {
      const saved = await this.persist('published')
      wx.hideLoading()
      wx.redirectTo({ url: `/pages/qrcode/qrcode?id=${saved.id}` })
    } catch (error) {
      wx.hideLoading()
      wx.showToast({ title: '生成失败，请重试', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  }
})
