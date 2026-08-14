Page({
  data: {},

  onCreateTap() {
    wx.navigateTo({ url: '/pages/list/list' })
  },

  onHistoryTap() {
    wx.navigateTo({ url: '/pages/history/history' })
  }
})
