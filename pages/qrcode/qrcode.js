import { getPublicArchive } from '../../utils/store'
import { getQrCode } from '../../utils/qrcode'

Page({
  data: {
    id: '',
    name: '',
    loaded: false,
    available: false,
    errorMessage: '',
    archivePath: '',
    qr: { ready: false, path: '', hint: '' }
  },

  async onLoad(options) {
    const id = options.id || ''
    try {
      const archive = await getPublicArchive(id)
      if (!archive || archive.status !== 'published') {
        this.setData({
          id,
          loaded: true,
          available: false,
          name: archive ? archive.name : ''
        })
        return
      }
      let qr
      try {
        qr = await getQrCode(id)
      } catch (error) {
        qr = { ready: false, path: '', hint: '二维码暂不可用，请稍后重试。' }
      }
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
        available: false,
        name: '',
        errorMessage: error.message || '云端档案加载失败'
      })
    }
  },

  onPreviewTap() {
    wx.navigateTo({ url: this.data.archivePath })
  },

  onSaveTap() {
    // 占位阶段不可用。TODO: 接上真码后改为 wx.saveImageToPhotosAlbum({ filePath: this.data.qr.path })
    if (!this.data.qr.ready) {
      wx.showToast({ title: '二维码尚未接入', icon: 'none' })
    }
  }
})
