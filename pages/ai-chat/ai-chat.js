import { sendTeaAiMessage } from '../../utils/ai'

function parseArchiveIds(options) {
  let raw = ''
  try {
    raw = decodeURIComponent(options.ids || '')
  } catch (error) {
    raw = ''
  }
  return Array.from(new Set(raw.split(',').map(item => item.trim()).filter(Boolean))).slice(0, 5)
}

Page({
  data: {
    archiveIds: [],
    selectedCount: 0,
    messages: [],
    inputValue: '',
    sending: false,
    scrollIntoView: ''
  },

  onLoad(options) {
    const archiveIds = parseArchiveIds(options)
    this.setData({ archiveIds, selectedCount: archiveIds.length })
    if (!archiveIds.length) {
      wx.showModal({
        title: '没有选择档案',
        content: '请返回历史记录，至少选择一份茶叶档案。',
        showCancel: false
      })
    }
  },

  onInput(event) {
    this.setData({ inputValue: event.detail.value })
  },

  async onSendTap() {
    const content = String(this.data.inputValue || '').trim()
    if (!content || this.data.sending || !this.data.archiveIds.length) return

    const userMessage = { role: 'user', content, id: `m_${Date.now()}_u` }
    const nextMessages = this.data.messages.concat(userMessage)
    this.setData({
      messages: nextMessages,
      inputValue: '',
      sending: true,
      scrollIntoView: userMessage.id
    })
    try {
      const result = await sendTeaAiMessage(
        this.data.archiveIds,
        nextMessages.map(item => ({ role: item.role, content: item.content }))
      )
      const assistantMessage = {
        role: 'assistant',
        content: result.answer || '对不起，该信息不存在',
        id: `m_${Date.now()}_a`
      }
      this.setData({
        messages: this.data.messages.concat(assistantMessage),
        scrollIntoView: assistantMessage.id
      })
    } catch (error) {
      wx.showToast({ title: error.message || 'AI 暂时无法回答', icon: 'none' })
    } finally {
      this.setData({ sending: false })
    }
  }
})
