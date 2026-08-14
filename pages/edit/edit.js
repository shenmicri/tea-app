import { SECTIONS, createEmptySections, findMissingRequired } from '../../config/schema'
import { getArchive, saveArchive, startArchiveDraft } from '../../utils/store'

function customId() {
  return 'cs_' + Math.random().toString(36).slice(2, 10)
}

function mediaId() {
  return 'media_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7)
}

function fileExtension(filePath, fallback) {
  const clean = String(filePath || '').split('?')[0]
  const match = clean.match(/\.([a-zA-Z0-9]{1,8})$/)
  return match ? match[1].toLowerCase() : fallback
}

function cloudPath(ownerToken, kind, filePath, fallbackExtension) {
  const extension = fileExtension(filePath, fallbackExtension)
  const random = Math.random().toString(36).slice(2, 10)
  return `tea-archives/${ownerToken}/${kind}/${Date.now()}-${random}.${extension}`
}

function uploadCloudFile(ownerToken, tempFilePath, kind, fallbackExtension) {
  if (!tempFilePath) return Promise.resolve('')
  return new Promise((resolve, reject) => {
    wx.cloud.uploadFile({
      cloudPath: cloudPath(ownerToken, kind, tempFilePath, fallbackExtension),
      filePath: tempFilePath,
      success: res => resolve(res.fileID),
      fail: reject
    })
  })
}

function normalizedImageExtension(value, fallbackPath) {
  const type = String(value || '').toLowerCase()
  if (type === 'jpeg' || type === 'jpg') return 'jpg'
  if (type === 'png' || type === 'gif') return type
  return fileExtension(fallbackPath, 'jpg')
}

function getLocalImageInfo(tempFilePath) {
  if (typeof wx.getImageInfo !== 'function') return Promise.resolve(null)
  return new Promise(resolve => wx.getImageInfo({
    src: tempFilePath,
    success: resolve,
    fail: () => resolve(null)
  }))
}

async function prepareSafetyCheckImage(tempFilePath) {
  const info = await getLocalImageInfo(tempFilePath)
  const extension = normalizedImageExtension(info && info.type, tempFilePath)
  if (!tempFilePath || typeof wx.compressImage !== 'function') {
    return { path: tempFilePath, extension }
  }

  const width = Math.max(1, Number(info && info.width) || 750)
  const height = Math.max(1, Number(info && info.height) || 1334)
  const scale = Math.min(1, 750 / width, 1334 / height)
  const compressedWidth = Math.max(1, Math.floor(width * scale))
  const compressedHeight = Math.max(1, Math.floor(height * scale))
  const path = await new Promise(resolve => wx.compressImage({
    src: tempFilePath,
    quality: 68,
    compressedWidth,
    compressedHeight,
    success: result => resolve(result.tempFilePath || tempFilePath),
    fail: () => resolve(tempFilePath)
  }))
  return { path, extension }
}

const CONTENT_RISK_CODES = ['TEXT_CONTENT_RISKY', 'IMAGE_CONTENT_RISKY']
const CONTENT_FIX_CODES = [
  'IMAGE_TOO_LARGE',
  'IMAGE_DIMENSIONS_TOO_LARGE',
  'IMAGE_FORMAT_UNSUPPORTED',
  'PUBLISH_IMAGE_LIMIT',
  'CONTENT_TOO_LONG'
]

function showPublishSafetyError(error) {
  const code = error && error.code
  if (CONTENT_RISK_CODES.includes(code)) {
    wx.showModal({
      title: '内容未通过安全检测',
      content: error.message || '请检查档案中的文字和图片，修改后再试。',
      showCancel: false,
      confirmText: '知道了'
    })
    return true
  }
  if (code === 'CONTENT_CHECK_UNAVAILABLE') {
    wx.showModal({
      title: '暂时无法完成安全检测',
      content: error.message || '请稍后重试。草稿内容不会丢失。',
      showCancel: false,
      confirmText: '知道了'
    })
    return true
  }
  if (code === 'PUBLISHED_MEDIA_COPY_FAILED') {
    wx.showModal({
      title: '暂时无法生成档案',
      content: error.message || '发布图片准备失败，请稍后重试。草稿内容不会丢失。',
      showCancel: false,
      confirmText: '知道了'
    })
    return true
  }
  if (CONTENT_FIX_CODES.includes(code)) {
    wx.showModal({
      title: '还不能生成档案',
      content: error.message || '请调整相关内容后重试。',
      showCancel: false,
      confirmText: '知道了'
    })
    return true
  }
  return false
}

Page({
  data: {
    SECTIONS,
    id: '',
    createdAt: 0,
    revision: 0,
    uploadToken: '',
    status: 'draft',
    sections: createEmptySections(), // 新建时全空，不预填任何内容
    customSections: [],
    collapsed: {}, // 区块折叠状态，默认全部展开
    canGenerate: false,
    initializing: true,
    saving: false,
    editorKeyboardHeight: 0,
    activeEditorId: ''
  },

  async onLoad(options) {
    const id = options.id || ''
    if (!id) {
      wx.setNavigationBarTitle({ title: '新建档案' })
      try {
        const reserved = await startArchiveDraft()
        this.setData({
          id: reserved.id,
          revision: reserved.revision,
          uploadToken: reserved.uploadToken,
          initializing: false
        })
      } catch (error) {
        this.setData({ initializing: false })
        wx.showModal({
          title: '云端服务尚未就绪',
          content: error.message || '请确认 archiveService 云函数已经部署。',
          showCancel: false
        })
      }
      return
    }
    wx.showLoading({ title: '正在加载' })
    try {
      const archive = await getArchive(id)
      if (!archive) {
        wx.showToast({ title: '档案不存在', icon: 'none' })
        return
      }
      wx.setNavigationBarTitle({ title: '编辑档案' })
      this.setData({
        id: archive.id,
        createdAt: archive.createdAt,
        revision: archive.revision,
        uploadToken: archive.uploadToken,
        initializing: false,
        status: archive.status,
        sections: archive.sections,
        customSections: archive.customSections,
        canGenerate: findMissingRequired(archive.sections).length === 0
      })
    } catch (error) {
      this.setData({ initializing: false })
      wx.showModal({
        title: '云端档案加载失败',
        content: error.message || '请检查网络以及 archiveService 云函数是否已经部署。',
        showCancel: false
      })
    } finally {
      wx.hideLoading()
    }
  },

  refreshCanGenerate() {
    this.setData({ canGenerate: findMissingRequired(this.data.sections).length === 0 })
  },

  onToggleSection(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ [`collapsed.${key}`]: !this.data.collapsed[key] })
  },

  onSaveBarTap() {},

  onEditorFocus(e) {
    const activeEditorId = String(e.currentTarget.dataset.focusId || '')
    this.setData({ activeEditorId }, () => this.ensureActiveEditorVisible())
  },

  onEditorKeyboardHeightChange(e) {
    const editorKeyboardHeight = Math.max(0, Number(e.detail && e.detail.height) || 0)
    this.setData({ editorKeyboardHeight }, () => this.ensureActiveEditorVisible())
  },

  ensureActiveEditorVisible() {
    const { activeEditorId, editorKeyboardHeight } = this.data
    if (!activeEditorId || !editorKeyboardHeight) return
    if (typeof wx.createSelectorQuery !== 'function' || typeof wx.pageScrollTo !== 'function') return
    setTimeout(() => {
      if (!this.data.editorKeyboardHeight || this.data.activeEditorId !== activeEditorId) return
      const query = wx.createSelectorQuery()
      query.select(`#${activeEditorId}`).boundingClientRect()
      query.selectViewport().scrollOffset()
      query.exec(result => {
        const fieldRect = result && result[0]
        const viewport = result && result[1]
        if (!fieldRect || !viewport) return
        wx.pageScrollTo({
          scrollTop: Math.max(0, viewport.scrollTop + fieldRect.top - 96),
          duration: 180
        })
      })
    }, 80)
  },

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
    if (!this.data.uploadToken) {
      wx.showToast({ title: '云端服务尚未就绪', icon: 'none' })
      return Promise.resolve()
    }
    const { section, field } = e.currentTarget.dataset
    return new Promise(resolve => wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: async res => {
        const file = res.tempFiles[0]
        if (file) {
          wx.showLoading({ title: '正在保存图片' })
          try {
            const prepared = await prepareSafetyCheckImage(file.tempFilePath)
            const savedPath = await uploadCloudFile(
              this.data.uploadToken,
              prepared.path,
              'covers',
              prepared.extension
            )
            this.setData({
              [`sections.${section}.${field}`]: prepared.path,
              [`sections.${section}.${field}FileId`]: savedPath
            }, () => {
              this.refreshCanGenerate()
            })
          } catch (error) {
            wx.showToast({ title: '图片保存失败，请重试', icon: 'none' })
          } finally {
            wx.hideLoading()
            resolve()
          }
        } else {
          resolve()
        }
      },
      fail: resolve
    }))
  },

  onCoverDelete(e) {
    const { section, field } = e.currentTarget.dataset
    this.setData({
      [`sections.${section}.${field}`]: '',
      [`sections.${section}.${field}FileId`]: ''
    }, () => {
      this.refreshCanGenerate()
    })
  },

  onMediaAdd(e) {
    if (!this.data.uploadToken) {
      wx.showToast({ title: '云端服务尚未就绪', icon: 'none' })
      return Promise.resolve()
    }
    const { section, field } = e.currentTarget.dataset
    return new Promise(resolve => wx.showActionSheet({
      itemList: ['添加图片', '添加视频'],
      success: choice => {
        const isVideo = choice.tapIndex === 1
        wx.chooseMedia({
          count: isVideo ? 1 : 9,
          mediaType: [isVideo ? 'video' : 'image'],
          sourceType: ['album', 'camera'],
          maxDuration: 60,
          success: async res => {
            wx.showLoading({ title: '正在保存媒体' })
            try {
              const added = await Promise.all(res.tempFiles.map(async file => {
                const prepared = isVideo
                  ? { path: file.tempFilePath, extension: 'mp4' }
                  : await prepareSafetyCheckImage(file.tempFilePath)
                const path = await uploadCloudFile(
                  this.data.uploadToken,
                  prepared.path,
                  isVideo ? 'videos' : 'images',
                  prepared.extension
                )
                let poster = ''
                let posterPreview = file.thumbTempFilePath || ''
                if (file.thumbTempFilePath) {
                  try {
                    const preparedPoster = await prepareSafetyCheckImage(file.thumbTempFilePath)
                    posterPreview = preparedPoster.path
                    poster = await uploadCloudFile(
                      this.data.uploadToken,
                      posterPreview,
                      'video-posters',
                      preparedPoster.extension
                    )
                  } catch (error) {
                    poster = ''
                  }
                }
                return {
                  id: mediaId(),
                  type: isVideo ? 'video' : 'image',
                  path: prepared.path,
                  fileId: path,
                  poster: posterPreview || poster,
                  posterFileId: poster,
                  duration: Math.round(Number(file.duration) || 0)
                }
              }))
              const current = this.data.sections[section][field] || []
              this.setData({ [`sections.${section}.${field}`]: current.concat(added) })
            } catch (error) {
              wx.showToast({ title: '媒体保存失败，请重试', icon: 'none' })
            } finally {
              wx.hideLoading()
              resolve()
            }
          },
          fail: resolve
        })
      },
      fail: resolve
    }))
  },

  onMediaDelete(e) {
    const { section, field, index } = e.currentTarget.dataset
    const current = (this.data.sections[section][field] || []).slice()
    current.splice(index, 1)
    this.setData({ [`sections.${section}.${field}`]: current })
  },

  onCustomAdd() {
    if (this.data.customSections.length >= 20) {
      wx.showToast({ title: '最多只能添加20个自定义项目', icon: 'none' })
      return
    }
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
      revision: this.data.revision,
      uploadToken: this.data.uploadToken,
      status,
      sections: this.data.sections,
      customSections: this.data.customSections
    })
    this.setData({
      id: saved.id,
      createdAt: saved.createdAt,
      revision: saved.revision,
      uploadToken: saved.uploadToken || this.data.uploadToken,
      status: saved.status
    })
    wx.setNavigationBarTitle({ title: '编辑档案' })
    return saved
  },

  async onSaveDraft() {
    if (this.data.saving || this.data.initializing) return
    if (!this.data.id || !this.data.uploadToken) {
      wx.showToast({ title: '云端服务尚未就绪', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    wx.showLoading({ title: '正在保存' })
    try {
      await this.persist('draft')
      wx.hideLoading()
      wx.showToast({ title: '草稿已保存', icon: 'success' })
    } catch (error) {
      wx.hideLoading()
      if (error.code === 'REVISION_CONFLICT') {
        wx.showModal({
          title: '档案已在其他地方更新',
          content: '为避免覆盖另一台设备上的修改，请返回列表后重新打开这份档案。',
          showCancel: false
        })
      } else {
        wx.showToast({ title: error.message || '保存失败，请重试', icon: 'none' })
      }
    } finally {
      this.setData({ saving: false })
    }
  },

  async onGenerate() {
    if (this.data.saving || this.data.initializing) return
    if (!this.data.id || !this.data.uploadToken) {
      wx.showToast({ title: '云端服务尚未就绪', icon: 'none' })
      return
    }
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
    const invalidCustom = this.data.customSections.find(item => {
      const title = (item.title || '').trim()
      const content = (item.content || '').trim()
      return content && !title
    })
    if (invalidCustom) {
      wx.showModal({
        title: '还不能生成档案',
        content: '有内容的自定义项目需要填写标题。当前内容仍可保存为草稿。',
        showCancel: false,
        confirmText: '知道了'
      })
      return
    }
    this.setData({ saving: true })
    wx.showLoading({ title: '检测并生成' })
    try {
      const saved = await this.persist('published')
      wx.hideLoading()
      wx.redirectTo({ url: `/pages/qrcode/qrcode?id=${saved.id}` })
    } catch (error) {
      wx.hideLoading()
      if (error.code === 'REVISION_CONFLICT') {
        wx.showModal({
          title: '档案已在其他地方更新',
          content: '为避免覆盖另一台设备上的修改，请返回列表后重新打开这份档案。',
          showCancel: false
        })
      } else if (showPublishSafetyError(error)) {
        // 安全检测相关错误已使用可完整阅读的弹窗提示。
      } else {
        wx.showToast({ title: error.message || '生成失败，请重试', icon: 'none' })
      }
    } finally {
      this.setData({ saving: false })
    }
  }
})
