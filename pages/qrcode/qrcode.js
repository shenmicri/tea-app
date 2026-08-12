import { getArchive } from '../../utils/store'
import { getQrCode } from '../../utils/qrcode'

Page({
  data: {
    id: '',
    name: '',
    loaded: false,
    available: false,
    archivePath: '',
    qr: { ready: false, path: '', hint: '' }
  },

  async onLoad(options) {
    const id = options.id || ''
    const archive = await getArchive(id)
    if (!archive || archive.status !== 'published') {
      this.setData({
        id,
        loaded: true,
        available: false,
        name: archive ? archive.name : ''
      })
      return
    }
    try {
      const qr = await getQrCode(id)
      this.setData({
        id,
        loaded: true,
        available: true,
        name: archive.name,
        archivePath: `/pages/archive/archive?id=${id}`,
        qr
      })
    } catch (error) {
      this.setData({
        id,
        loaded: true,
        available: true,
        name: archive.name,
        archivePath: `/pages/archive/archive?id=${id}`,
        qr: { ready: false, path: '', hint: '二维码暂不可用，请使用下方测试入口。' }
      })
    }
  },

  onPreviewTap() {
    wx.navigateTo({ url: this.data.archivePath })
  },

  onCopyLinkTap() {
    wx.setClipboardData({
      data: this.data.archivePath,
      success: () => wx.showToast({ title: '测试路径已复制', icon: 'success' })
    })
  },

  onSaveTap() {
    // 占位阶段不可用。TODO: 接上真码后改为 wx.saveImageToPhotosAlbum({ filePath: this.data.qr.path })
    if (!this.data.qr.ready) {
      wx.showToast({ title: '二维码尚未接入', icon: 'none' })
    }
  }
})
