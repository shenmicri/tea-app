import { listArchives } from '../../utils/store'

function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const pad = n => (n < 10 ? '0' + n : '' + n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

Page({
  data: {
    archives: [],
    loaded: false
  },

  onShow() {
    this.load()
  },

  async load() {
    const archives = await listArchives()
    this.setData({
      loaded: true,
      archives: archives.map(item => ({
        id: item.id,
        name: item.name || '未命名',
        category: item.sections.basic.category || '',
        updatedText: formatTime(item.updatedAt)
      }))
    })
  },

  onItemTap(e) {
    wx.navigateTo({ url: `/pages/edit/edit?id=${e.currentTarget.dataset.id}` })
  },

  onQrcodeTap(e) {
    wx.navigateTo({ url: `/pages/qrcode/qrcode?id=${e.currentTarget.dataset.id}` })
  },

  onCreateTap() {
    wx.navigateTo({ url: '/pages/edit/edit' })
  }
})
