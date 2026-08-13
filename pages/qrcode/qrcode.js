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
    qr: { ready: false, path: '', hint: '' },
    savingImage: false
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
        qr = {
          ready: false,
          path: '',
          fileId: '',
          hint: error.message || '小程序码暂不可用，请稍后重试。'
        }
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

  async onSaveTap() {
    if (this.data.savingImage) return
    if (!this.data.qr.ready) {
      wx.showToast({ title: '小程序码暂不可用', icon: 'none' })
      return
    }
    this.setData({ savingImage: true })
    wx.showLoading({ title: '正在保存' })
    try {
      await new Promise((resolve, reject) => wx.saveImageToPhotosAlbum({
        filePath: this.data.qr.path,
        success: resolve,
        fail: reject
      }))
      wx.hideLoading()
      wx.showToast({ title: '已保存到相册', icon: 'success' })
    } catch (error) {
      wx.hideLoading()
      const denied = error && /auth deny|authorize|permission|writePhotosAlbum/i.test(error.errMsg || error.message || '')
      if (denied && typeof wx.openSetting === 'function') {
        wx.showModal({
          title: '需要相册权限',
          content: '请在设置中允许保存到相册，然后重新点击保存。',
          confirmText: '去设置',
          success: result => { if (result.confirm) wx.openSetting() }
        })
      } else {
        wx.showToast({ title: '保存失败，请重试', icon: 'none' })
      }
    } finally {
      this.setData({ savingImage: false })
    }
  }
})
