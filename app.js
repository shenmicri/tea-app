App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('当前微信基础库不支持云开发，请升级基础库后重试。')
      return
    }
    wx.cloud.init({
      // 明确绑定三张 Collection 和 archiveService 所在的云环境，
      // 避免开发者工具切换默认环境后误写到别的数据库。
      env: 'cloud1-d7gj8sm08090886d3',
      traceUser: true
    })
  }
})
