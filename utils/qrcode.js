/**
 * 小程序码。
 * 真正的码必须由云函数调用微信 getUnlimited 接口生成，本地阶段做不到，
 * 所以这里先返回占位，页面按 ready 判断显示占位方块还是真码。
 */

/**
 * @param {string} id 档案 id，会作为码的 scene 参数
 * @returns {Promise<{ready: boolean, path: string, id: string, hint: string}>}
 */
export async function getQrCode(id) {
  // TODO: 接入云开发后改成下面这段，并删掉占位返回：
  //
  // const res = await wx.cloud.callFunction({
  //   name: 'getQrCode',
  //   data: {
  //     scene: id,                          // 档案 id，上限 32 字符，所以 id 用的是 8 位短 id
  //     page: 'pages/archive/archive'       // 扫码后打开的页面，id 从 scene 里取
  //   }
  // })
  // 云函数内部：cloud.openapi.wxacode.getUnlimited({ scene, page })
  // 返回的是 Buffer，需写入临时文件后把路径给 image 组件。
  // return { ready: true, path: res.result.tempFilePath, id, hint: '' }

  return {
    ready: false,
    path: '',
    id,
    hint: '二维码待接入云函数生成'
  }
}
