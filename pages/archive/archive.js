import { SECTIONS } from '../../config/schema'
import { getArchive } from '../../utils/store'

Page({
  data: {
    SECTIONS,
    loaded: false,
    found: false,
    headerName: '',
    headerCategory: '',
    sections: {},
    customSections: []
  },

  async onLoad(options) {
    // 消费者扫码进来只带 id，不经过首页。
    const archive = await getArchive(options.id || '')
    if (!archive) {
      this.setData({ loaded: true, found: false })
      return
    }
    this.setData({
      loaded: true,
      found: true,
      // 顶部标题是本页唯一直接引用具体字段的地方，其余全部按 schema 渲染。
      headerName: archive.sections.basic.name,
      headerCategory: archive.sections.basic.category,
      sections: archive.sections,
      // 内容为空的自定义区块整块不显示
      customSections: archive.customSections.filter(item => item.content && item.content.trim())
    })
    wx.setNavigationBarTitle({ title: archive.name || '茶叶档案' })
  }
})
