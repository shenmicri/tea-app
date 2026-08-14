import { listViewHistory } from '../../utils/store'

function formatTime(ts) {
  if (!ts) return ''
  const date = new Date(ts)
  const pad = value => (value < 10 ? `0${value}` : `${value}`)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

Page({
  data: {
    records: [],
    loaded: false,
    loadError: ''
  },

  onShow() {
    this.load()
  },

  async load() {
    this.setData({ loadError: '' })
    try {
      const rows = await listViewHistory()
      this.setData({
        loaded: true,
        records: rows.map(item => ({
          id: item.id,
          name: item.name || '未命名',
          category: item.category || '未填写茶类',
          viewedText: formatTime(item.lastViewedAt)
        }))
      })
    } catch (error) {
      this.setData({
        loaded: true,
        records: [],
        loadError: error.message || '历史记录加载失败'
      })
    }
  },

  onRetryTap() {
    this.setData({ loaded: false })
    this.load()
  },

  onRecordTap(event) {
    const id = event.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: `/pages/archive/archive?id=${id}` })
  }
})
