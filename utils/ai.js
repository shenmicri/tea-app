const AI_FUNCTION_NAME = 'teaAi'

export async function sendTeaAiMessage(archiveIds, messages) {
  const response = await wx.cloud.callFunction({
    name: AI_FUNCTION_NAME,
    data: {
      action: 'chat',
      archiveIds,
      messages
    }
  })
  const result = response && response.result
  if (!result || result.ok !== true) {
    const remote = result && result.error
    const error = new Error((remote && remote.message) || 'AI 暂时无法回答，请稍后重试')
    error.code = (remote && remote.code) || 'AI_SERVICE_ERROR'
    throw error
  }
  return result.data
}
