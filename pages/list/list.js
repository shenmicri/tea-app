import { copyArchive, listArchives } from '../../utils/store'

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
        published: item.status === 'published',
        statusText: item.status === 'published' ? '已生成' : '草稿',
        updatedText: formatTime(item.updatedAt)
      }))
    })
  },

  onItemTap(e) {
    wx.navigateTo({ url: `/pages/edit/edit?id=${e.currentTarget.dataset.id}` })
  },

  onQrcodeTap(e) {
    const published = e.currentTarget.dataset.published
    if (!(published === true || published === 'true')) {
      wx.showToast({ title: '请先补齐必填信息并生成档案', icon: 'none' })
      return
    }
    wx.navigateTo({ url: `/pages/qrcode/qrcode?id=${e.currentTarget.dataset.id}` })
  },

  onCopyTap(e) {
    const { id, name } = e.currentTarget.dataset
    wx.showModal({
      title: '复制档案',
      content: `复制「${name}」并进入副本编辑？原档案不会改变。`,
      confirmText: '复制',
      success: async res => {
        if (!res.confirm) return
        wx.showLoading({ title: '正在复制' })
        try {
          const copied = await copyArchive(id)
          if (!copied) {
            wx.showToast({ title: '原档案不存在', icon: 'none' })
            return
          }
          wx.navigateTo({ url: `/pages/edit/edit?id=${copied.id}` })
        } catch (error) {
          wx.showToast({ title: '复制失败，请重试', icon: 'none' })
        } finally {
          wx.hideLoading()
        }
      }
    })
  },

  onCreateTap() {
    wx.navigateTo({ url: '/pages/edit/edit' })
  }
})
