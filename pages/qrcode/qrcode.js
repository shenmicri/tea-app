import { getArchive } from '../../utils/store'
import { getQrCode } from '../../utils/qrcode'

Page({
  data: {
    id: '',
    name: '',
    qr: { ready: false, path: '', hint: '' }
  },

  async onLoad(options) {
    const id = options.id || ''
    const archive = await getArchive(id)
    const qr = await getQrCode(id)
    this.setData({
      id,
      name: archive ? archive.name : '',
      qr
    })
  },

  onSaveTap() {
    // 占位阶段不可用。TODO: 接上真码后改为 wx.saveImageToPhotosAlbum({ filePath: this.data.qr.path })
    if (!this.data.qr.ready) {
      wx.showToast({ title: '二维码尚未接入', icon: 'none' })
    }
  }
})
