/**
 * 获取当前卖家已生成档案的小程序码。
 * 小程序码由 archiveService 在云端调用 wxacode.getUnlimited 创建，再落成本地图片供展示和保存。
 */
export async function getQrCode(id) {
  const response = await wx.cloud.callFunction({
    name: 'archiveService',
    data: { action: 'getQrCode', id }
  })
  const result = response && response.result
  if (!result || result.ok !== true) {
    const remote = result && result.error
    const error = new Error((remote && remote.message) || '小程序码暂时不可用，请稍后重试')
    error.code = (remote && remote.code) || 'QR_CODE_ERROR'
    throw error
  }
  if (!result.data || !result.data.file_base64) {
    const error = new Error('小程序码暂时无法显示，请稍后重试')
    error.code = 'QR_CODE_FILE_FAILED'
    throw error
  }
  const extension = result.data.mime_type === 'image/png' ? 'png' : 'jpg'
  const localPath = `${wx.env.USER_DATA_PATH}/archive-code-${id}.${extension}`
  await new Promise((resolve, reject) => wx.getFileSystemManager().writeFile({
    filePath: localPath,
    data: result.data.file_base64,
    encoding: 'base64',
    success: resolve,
    fail: reject
  }))
  return {
    ready: true,
    path: localPath,
    fileId: result.data.file_id || '',
    id,
    hint: ''
  }
}
