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
    if (!id) {
      this.setData({
        loaded: true,
        available: false,
        errorMessage: '缺少档案编号'
      })
      return
    }
    this.setData({
      id,
      loaded: true,
      available: true,
      archivePath: `/pages/archive/archive?id=${id}`,
      qr: { ready: false, path: '', hint: '正在加载小程序码…' }
    })
    try {
      const qr = await getQrCode(id)
      this.setData({
        name: qr.name,
        qr
      })
    } catch (error) {
      const unavailable = ['QR_ARCHIVE_NOT_PUBLISHED', 'NOT_FOUND', 'FORBIDDEN'].includes(error.code)
      if (unavailable) {
        this.setData({
          available: false,
          errorMessage: error.message || '这份档案尚未生成'
        })
      } else {
        this.setData({
          qr: {
            ready: false,
            path: '',
            fileId: '',
            hint: error.message || '小程序码暂不可用，请稍后重试。'
          }
        })
      }
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
