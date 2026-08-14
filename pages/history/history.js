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
    loadError: '',
    selecting: false,
    selectedMap: {},
    selectedCount: 0
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
    if (this.data.selecting) {
      this.toggleRecord(id)
      return
    }
    wx.navigateTo({ url: `/pages/archive/archive?id=${id}` })
  },

  onSelectModeTap() {
    if (this.data.selecting) {
      this.setData({ selecting: false, selectedMap: {}, selectedCount: 0 })
      return
    }
    this.setData({ selecting: true, selectedMap: {}, selectedCount: 0 })
  },

  onCircleTap(event) {
    const id = event.currentTarget.dataset.id
    if (id) this.toggleRecord(id)
  },

  toggleRecord(id) {
    const selected = Boolean(this.data.selectedMap[id])
    if (!selected && this.data.selectedCount >= 5) {
      wx.showToast({ title: '最多选择5份档案', icon: 'none' })
      return
    }
    this.setData({
      [`selectedMap.${id}`]: !selected,
      selectedCount: this.data.selectedCount + (selected ? -1 : 1)
    })
  },

  onConfirmTap() {
    if (!this.data.selecting || this.data.selectedCount < 1) return
    const ids = Object.keys(this.data.selectedMap).filter(id => this.data.selectedMap[id]).slice(0, 5)
    if (!ids.length) return
    wx.navigateTo({ url: `/pages/ai-chat/ai-chat?ids=${encodeURIComponent(ids.join(','))}` })
  }
})
