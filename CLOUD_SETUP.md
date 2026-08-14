# 微信云数据库部署清单

代码已经按下面四个 Collection 连接，名称必须完全一致（包括大小写）：

- `tea_archives`：档案的固定草稿记录、固定已发布记录与文字字段
- `archive_media`：三个固定大分类下的图片、视频和视频封面
- `archive_custom_items`：最多 20 个自定义项目；消费者页不显示共同的大分类标题
- `archive_view_history`：每个用户曾经成功打开过的已发布档案及最近查看时间

## 第一次部署

1. 在微信开发者工具中打开本项目，确认顶部“云开发”当前环境就是你建立四个 Collection 的环境。
2. 在文件树中右键 `cloudfunctions`，选择同一个“当前环境”。
3. 右键 `cloudfunctions/archiveService`，选择“上传并部署：云端安装依赖”。只有创建 Collection 还不够，这一步会部署负责档案与访问历史读写的云函数。
   - 本次部署还会为云函数申请 `security.msgSecCheck` 和 `security.imgSecCheck` 两项 OpenAPI 权限；如果开发者工具或控制台弹出授权确认，请确认这两项后再部署。
   - 不要添加 `security.mediaCheckAsync` 权限。本项目的文字发布检测使用 `msgSecCheck`，主视觉和分类图片使用 `imgSecCheck`；视频按产品设置直接发布，不做自动内容审核。
   - 部署时使用 Node.js 16 或 18 运行环境。
   - 部署后进入 `archiveService` 的函数配置，将“执行超时时间”改为 **60 秒**并保存。函数目录内的 `config.json` 不负责这一项；如果不在控制台修改，首次部署仍可能使用默认 3 秒，导致较多媒体或自定义项目保存失败。
   - 这次增加了内容安全与发布图片副本逻辑，必须重新上传整个 `archiveService`，不能只在开发者工具里点击“编译”小程序。
4. 四个 Collection 的客户端读写权限都设为“仅管理端可读写”。本项目不会让客户端直接查询数据库：卖家操作、消费者公开读取和访问历史都经过 `archiveService`，草稿与不同用户的历史不会因数据库权限过宽而泄露。
5. 云存储使用“所有用户可读，仅创建者及管理员可写”或更严格的“仅创建者及管理员可读写”；写权限必须保持 `resource.openid == auth.openid`。消费者打开已生成档案时，云函数会把其中的文件 ID 换成临时访问地址，不需要把四个数据库 Collection 设为全员可读。采用私有读取规则时，需要用另一个微信账号实测一次公开档案的图片与视频。

本项目当前明确连接以下云环境：

```js
env: 'cloud1-d7gj8sm08090886d3'
```

开发者工具当前环境、四个 Collection 和 `archiveService` 都必须位于这个环境。如果以后建立正式环境，需要同时修改 `app.js` 并把四个 Collection 与云函数部署到新环境。

## 建议索引

数据量较小时不建也能使用；正式使用前建议在云数据库中建立：

- `tea_archives`：`owner_openid`
- `archive_media`：`archive_id`
- `archive_custom_items`：`archive_id`
- `archive_view_history`：分别建立 `owner_openid` 和 `archive_id` 索引

每份档案有一个稳定的 8 位 `archive_id`。`tea_archives` 不保存历史版本，只使用两个固定文档键：

- `${archive_id}_draft`：编辑页读取和“保存草稿”覆盖的工作副本
- `${archive_id}_published`：消费者档案和小程序码读取的线上副本

刚进入新建页时不会写入 `tea_archives`；第一次保存草稿后只有 `draft` 一条，第一次生成后固定为 `draft + published` 两条。此后保存草稿只覆盖 draft，生成档案同时覆盖 draft 与 published，不会再增加第三条主记录。两个子 Collection 的 `archive_id` 都指向同一个 8 位档案编号，并用 `record_type: draft|published` 区分工作副本和线上副本；同样只覆盖固定子记录，不保留每次保存的历史行。

## 验收顺序

1. 新建一份基本信息不完整的档案，点“保存草稿”：应成功保存，但不能打开消费者档案。
2. 补齐茶名、茶类、档案主视觉和产品简介，点“生成档案”：应进入二维码／链接页，并可“直接查看档案”。
3. 在三个固定大分类中添加多张图片及视频：重新打开编辑页和消费者页后媒体仍应存在。
4. 添加到第 20 个自定义项目：第 21 个必须被阻止；有内容但没有标题时可以保存草稿，但不能生成档案。
5. 在列表复制一份档案：副本应包含文字、媒体和自定义项目，但状态必须是草稿。
6. 查看 `archiveService` 云函数日志：不应出现 `Cannot find module 'wx-server-sdk'` 或超时错误。
7. 验证四张 Collection 的客户端直接读取会被拒绝；所有合法读写只能经 `archiveService`。
8. 删除一份已经生成的档案：原来的测试路径应立即显示档案不可用。
9. 输入明显不合规的测试文字或图片再点“生成档案”：应显示安全检测提示且不进入二维码页；改成正常内容后可以重新生成。保存草稿不触发发布检测。
10. 用消费者账号成功打开一份已发布档案，再回到首页进入“历史记录”：列表只显示茶名、茶类和最近查看时间。重复打开同一档案时，`archive_view_history` 仍只有该用户与该档案的一条记录，但 `last_viewed_at` 会更新；另一个微信用户看不到这条历史。

`imgSecCheck` 只检查图片，单张图片需为 JPG、PNG 或 GIF，大小不超过 1MB、尺寸不超过 750×1334；每份档案最多发布 30 张图片。编辑页会先读取图片尺寸，再按这两个边界等比缩小；如果文件仍超过 1MB，生成时会明确提示重新压缩或更换。视频可以直接生成到公开档案，项目不会对视频文件或视频封面调用内容安全接口，也没有调用 `mediaCheckAsync`。

安全检测通过后，`archiveService` 会把图片 Buffer 复制到 `tea-archives-published/` 发布目录，并让公开档案只引用这份不可变发布副本。请把云存储权限改成“自定义安全规则”，至少确保客户端不能覆盖该目录；官方规则中云函数/管理端不受客户端规则限制，可使用：

```json
{
  "read": "resource.openid == auth.openid || resource.openid == auth.uid",
  "write": "auth != null && /^tea-archives-published\\//.test(resource.path) == false && (resource.openid == auth.openid || resource.openid == auth.uid)"
}
```

公开档案仍由云函数为发布副本签发临时访问地址。规则修改通常需要 1–3 分钟生效；生效后应实测卖家仍能上传草稿图片，同时客户端无法向 `tea-archives-published/` 写入或覆盖文件。

## 小程序码

`archiveService` 使用 `wxacode.getUnlimited` 生成小程序码，`scene` 是 8 位档案 ID，扫码目标固定为 `pages/archive/archive`。同一档案会复用已保存的小程序码，不会在每次打开页面时重复创建；删除档案时会同时删除对应码文件。码图由云函数返回并写成小程序本地图片，因此展示和“保存到相册”不依赖临时链接有效期，也不需要另配 `downloadFile` 合法域名。

小程序码页面只调用一次 `getQrCode`：云函数直接读取 `${archive_id}_published`，同时返回茶名、档案编号和二维码，不再先加载完整消费者档案，也不会查询 `archive_media`、`archive_custom_items` 或 `archive_view_history`。返回中的 `cache_status` 为 `generated` 表示本次首次生成，为 `hit` 表示复用了数据库中的 `qr_code_file_id`。页面会先显示加载占位，再异步替换成二维码，避免网络等待期间整页空白。

1. 本次重新部署 `archiveService` 时，确认新增的 `wxacode.getUnlimited` OpenAPI 权限已经授权。
2. 小程序码扫码会打开正式版小程序，因此正式使用前必须发布包含 `pages/archive/archive` 的小程序版本；开发版或体验版中可以生成、展示和保存码，但用普通微信扫码时仍以正式版为准。
3. 部署完成后，用一份已生成档案进入小程序码页：应显示真码，“保存到相册”可保存图片；再用另一台手机扫码，应直接打开对应消费者档案。

已经生成的档案再次编辑并“保存草稿”时，消费者仍会看到上一次生成的完整版本；只有再次点“生成档案”，线上版本才会更新。列表中的状态表示当前工作副本是草稿还是已生成。

## 首页与历史记录

小程序启动页现在是 `pages/index/index`。主页“新建档案”进入现有卖家档案列表，“历史记录”进入 `pages/history/history`。只有 `pages/archive/archive` 成功加载 published 档案后才调用 `recordView`；二维码管理页检查档案是否可用时不会产生访问历史。

`archive_view_history` 使用“当前用户 OpenID + archive_id”的固定哈希 `_id`。同一用户重复打开同一档案只覆盖 `last_viewed_at`，不会新增重复记录；不同用户的记录彼此独立。历史列表不会复制或返回主视觉、简介及其他档案正文，而是读取当前 published 记录并只返回茶名、茶类和最近查看时间。档案删除后，对应的历史引用会清理；已经不可用的档案不会出现在历史列表中。

## 茶叶档案 AI

AI 聊天由独立云函数 `teaAi` 提供。历史记录页可进入选择状态，一次最多选择 5 份当前账号实际查看过的档案；AI 只读取这些档案已发布版本中的文字字段和自定义项目，不读取图片、视频或媒体文件。页面关闭后聊天记录不会写入数据库或本地缓存。

首次使用前需要完成以下配置：

1. 右键 `cloudfunctions/teaAi`，选择“上传并部署：云端安装依赖”。它必须与 `archiveService`、四个 Collection 位于同一个云环境。
2. 在云开发控制台进入 `teaAi` 的函数配置，添加环境变量 `DEEPSEEK_API_KEY`，值填写有效的 DeepSeek API Key。密钥只能放在云函数环境变量中，不要写入 `app.js`、页面 JavaScript、仓库文件或数据库。
3. 将 `teaAi` 的执行超时时间设为 **60 秒**。AI 请求为非流式请求，默认 3 秒会导致手机端频繁超时。
4. 确认部署时已授权 `security.msgSecCheck`。用户问题和 AI 回答都会在云函数端进行文字安全检测；检测失败或接口不可用时，本次回答会被阻止。
5. 云函数使用 DeepSeek 的 `deepseek-v4-flash` 模型、关闭思考模式并设置 `stream: false`。调用发生在云函数服务器端，因此不需要把 DeepSeek 域名加入小程序客户端的 request 合法域名，也不会把 API Key 下发到手机。

部署后按以下顺序验收：

1. 用消费者账号打开至少一份已发布档案，让它进入历史记录。
2. 在历史记录右上角点“选择”，确认最多可选 5 份；未选择时“确定”为灰色且不可点击。
3. 选择档案并点“确定”，进入聊天页。页面应先等待用户输入，不自动总结。
4. 提问档案中已有的信息，应返回基于档案文字的回答；询问档案没有提供的内容，应回答“对不起，该信息不存在”。
5. 退出聊天页后重新进入，旧聊天内容应为空。
6. 查看 `teaAi` 云函数日志，确认没有 `AI_NOT_CONFIGURED`、超时或 OpenAPI 权限错误；日志不应包含 API Key、档案正文、用户问题或 AI 回答。

## 数据说明

改为云数据库后，之前只存在于本机 `StorageSync` 的测试档案不会自动迁移。原来的本地图片路径也不适合直接写入云端；如有必须保留的数据，应重新上传媒体后再录入。

早期云端版本曾使用 `_id = archive_id`、`working_version`、`published_version` 和 `published_snapshot` 保存一条主记录并创建多批子记录。新版云函数会兼容读取这些旧档案，并在该档案下一次保存草稿或生成时，在同一个数据库事务内转换成固定的 `${archive_id}_draft` / `${archive_id}_published` 结构，同时删除该档案旧的版本化子记录。为了避免误删本来就是不同茶叶的测试档案，系统不会把多个不同 `archive_id` 自动合并；确认无用的旧测试档案仍需由你在列表中逐份删除，或在数据库控制台核对后手动清理。
