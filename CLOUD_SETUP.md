# 微信云数据库部署清单

代码已经按下面三个 Collection 连接，名称必须完全一致（包括大小写）：

- `tea_archives`：档案主记录与固定文字字段
- `archive_media`：三个固定大分类下的图片、视频和视频封面
- `archive_custom_items`：最多 20 个自定义项目；消费者页不显示共同的大分类标题

## 第一次部署

1. 在微信开发者工具中打开本项目，确认顶部“云开发”当前环境就是你建立三个 Collection 的环境。
2. 在文件树中右键 `cloudfunctions`，选择同一个“当前环境”。
3. 右键 `cloudfunctions/archiveService`，选择“上传并部署：云端安装依赖”。只有创建 Collection 还不够，这一步会部署负责三表读写的云函数。
   - 本次部署还会为云函数申请 `security.msgSecCheck` 和 `security.imgSecCheck` 两项 OpenAPI 权限；如果开发者工具或控制台弹出授权确认，请确认这两项后再部署。
   - 不要添加 `security.mediaCheckAsync` 权限。本项目的文字发布检测使用 `msgSecCheck`，主视觉和分类图片使用 `imgSecCheck`；视频只能保留在草稿中。
   - 部署时使用 Node.js 16 或 18 运行环境。
   - 部署后进入 `archiveService` 的函数配置，将“执行超时时间”改为 **60 秒**并保存。函数目录内的 `config.json` 不负责这一项；如果不在控制台修改，首次部署仍可能使用默认 3 秒，导致较多媒体或自定义项目保存失败。
   - 这次增加了内容安全与发布图片副本逻辑，必须重新上传整个 `archiveService`，不能只在开发者工具里点击“编译”小程序。
4. 三个 Collection 的客户端读写权限都设为“仅管理端可读写”。本项目不会让客户端直接查询数据库：卖家操作和消费者公开读取都经过 `archiveService`，草稿不会因数据库权限过宽而泄露。
5. 云存储使用“所有用户可读，仅创建者及管理员可写”或更严格的“仅创建者及管理员可读写”；写权限必须保持 `resource.openid == auth.openid`。消费者打开已生成档案时，云函数会把其中的文件 ID 换成临时访问地址，不需要把三个数据库 Collection 设为全员可读。采用私有读取规则时，需要用另一个微信账号实测一次公开档案的图片与视频。

本项目当前明确连接以下云环境：

```js
env: 'cloud1-d7gj8sm08090886d3'
```

开发者工具当前环境、三个 Collection 和 `archiveService` 都必须位于这个环境。如果以后建立正式环境，需要同时修改 `app.js` 并把三个 Collection 与云函数部署到新环境。

## 建议索引

数据量较小时不建也能使用；正式使用前建议在云数据库中建立：

- `tea_archives`：`owner_openid`
- `archive_media`：`archive_id`
- `archive_custom_items`：`archive_id`

短档案编号直接作为 `tea_archives._id`；两个子 Collection 的 `archive_id` 指向该编号。

## 验收顺序

1. 新建一份基本信息不完整的档案，点“保存草稿”：应成功保存，但不能打开消费者档案。
2. 补齐茶名、茶类、档案主视觉和产品简介，点“生成档案”：应进入二维码／链接页，并可“直接查看档案”。
3. 在三个固定大分类中添加多张图片及视频：重新打开编辑页和消费者页后媒体仍应存在。
4. 添加到第 20 个自定义项目：第 21 个必须被阻止；有内容但没有标题时可以保存草稿，但不能生成档案。
5. 在列表复制一份档案：副本应包含文字、媒体和自定义项目，但状态必须是草稿。
6. 查看 `archiveService` 云函数日志：不应出现 `Cannot find module 'wx-server-sdk'` 或超时错误。
7. 验证三张 Collection 的客户端直接读取会被拒绝；所有合法读写只能经 `archiveService`。
8. 删除一份已经生成的档案：原来的测试路径应立即显示档案不可用。
9. 输入明显不合规的测试文字或图片再点“生成档案”：应显示安全检测提示且不进入二维码页；改成正常内容后可以重新生成。保存草稿不触发发布检测。

`imgSecCheck` 只能检查图片，单张图片需为 JPG、PNG 或 GIF，大小不超过 1MB、尺寸不超过 750×1334；每份档案最多发布 30 张图片。编辑页会先读取图片尺寸，再按这两个边界等比缩小；如果文件仍超过 1MB，生成时会明确提示重新压缩或更换。视频可以上传并保存在草稿中，但 `imgSecCheck` 无法识别视频正文，因此含视频的草稿当前不能生成公开档案；项目没有调用 `mediaCheckAsync`。

安全检测通过后，`archiveService` 会把图片 Buffer 复制到 `tea-archives-published/` 发布目录，并让公开档案只引用这份不可变发布副本。请把云存储权限改成“自定义安全规则”，至少确保客户端不能覆盖该目录；官方规则中云函数/管理端不受客户端规则限制，可使用：

```json
{
  "read": "resource.openid == auth.openid || resource.openid == auth.uid",
  "write": "auth != null && /^tea-archives-published\\//.test(resource.path) == false && (resource.openid == auth.openid || resource.openid == auth.uid)"
}
```

公开档案仍由云函数为发布副本签发临时访问地址。规则修改通常需要 1–3 分钟生效；生效后应实测卖家仍能上传草稿图片，同时客户端无法向 `tea-archives-published/` 写入或覆盖文件。

已经生成的档案再次编辑并“保存草稿”时，消费者仍会看到上一次生成的完整版本；只有再次点“生成档案”，线上版本才会更新。列表中的状态表示当前工作副本是草稿还是已生成。

## 数据说明

改为云数据库后，之前只存在于本机 `StorageSync` 的测试档案不会自动迁移。原来的本地图片路径也不适合直接写入云端；如有必须保留的数据，应重新上传媒体后再录入。
