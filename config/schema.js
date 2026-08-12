/**
 * 字段定义的唯一来源。
 * 表单页（pages/edit）与档案页（pages/archive）都从这里渲染，页面里不写死任何字段。
 *
 * 字段属性：
 *   key      存进 archive.sections[sectionKey][fieldKey]，同一区块内唯一。改 key 属破坏性改动。
 *   label    表单与档案页共用的显示名，随便改。
 *   type     'text' | 'textarea' | 'picker' | 'cover' | 'media' 五选一。
 *   required 基本信息里生成档案前必须填写的字段。
 *   icon     消费者页使用的分类图标。同一页面中的语义图标不可重复。
 *   options  仅 picker 使用。
 *
 * 约定：这里不出现任何 default / placeholder 预填内容。
 * 平台不生成任何茶叶信息，所有内容只能来自卖家手动输入。
 */

export const SECTIONS = [
  {
    key: 'basic',
    title: '基本信息',
    fields: [
      { key: 'name', label: '茶名', type: 'text', required: true },
      {
        key: 'category',
        label: '茶类',
        type: 'picker',
        required: true,
        options: ['绿茶', '白茶', '黄茶', '青茶（乌龙）', '红茶', '黑茶', '再加工茶', '其他']
      },
      { key: 'coverImage', label: '档案主视觉', type: 'cover', required: true },
      { key: 'summary', label: '产品简介', type: 'textarea', required: true },
      { key: 'code', label: '产品编号', type: 'text' }
    ]
  },
  {
    key: 'feature',
    title: '特点、制作与使用',
    icon: '/assets/icons/tea-archive/sparkle.png',
    fields: [
      { key: 'profile', label: '茶叶特点', type: 'textarea', icon: '/assets/icons/tea-archive/flower-tulip.png' },
      { key: 'craft', label: '制作工艺', type: 'textarea', icon: '/assets/icons/tea-archive/wind.png' },
      { key: 'usage', label: '冲泡、储存与注意事项', type: 'textarea', icon: '/assets/icons/tea-archive/tea-bag.png' },
      { key: 'media', label: '图片与视频', type: 'media', icon: '/assets/icons/tea-archive/camera.png' }
    ]
  },
  {
    key: 'origin',
    title: '产地与原料',
    icon: '/assets/icons/tea-archive/mountains.png',
    fields: [
      { key: 'place', label: '产地与生长环境', type: 'textarea', icon: '/assets/icons/tea-archive/map-pin.png' },
      { key: 'rawMaterial', label: '茶树与原料', type: 'textarea', icon: '/assets/icons/tea-archive/plant.png' },
      { key: 'harvest', label: '种植与采摘', type: 'textarea', icon: '/assets/icons/tea-archive/scissors.png' },
      { key: 'media', label: '图片与视频', type: 'media', icon: '/assets/icons/tea-archive/image.png' }
    ]
  },
  {
    key: 'brand',
    title: '品牌与故事',
    icon: '/assets/icons/tea-archive/book-open.png',
    fields: [
      { key: 'brandName', label: '品牌或店铺名称', type: 'text', icon: '/assets/icons/tea-archive/storefront.png' },
      { key: 'story', label: '品牌、茶园或制茶人故事', type: 'textarea', icon: '/assets/icons/tea-archive/scroll.png' },
      { key: 'contactInfo', label: '联系信息', type: 'textarea', icon: '/assets/icons/tea-archive/address-book.png' },
      { key: 'media', label: '图片与视频', type: 'media', icon: '/assets/icons/tea-archive/film-slate.png' }
    ]
  }
]

/** 按 schema 生成一份全空的 sections，字段一律为空字符串或空数组。 */
export function createEmptySections() {
  const sections = {}
  SECTIONS.forEach(section => {
    sections[section.key] = {}
    section.fields.forEach(field => {
      sections[section.key][field.key] = field.type === 'media' ? [] : ''
    })
  })
  return sections
}

/** 返回所有 required 字段中值为空的 label 列表。 */
export function findMissingRequired(sections) {
  const missing = []
  SECTIONS.forEach(section => {
    section.fields.forEach(field => {
      if (!field.required) return
      const value = (sections[section.key] || {})[field.key]
      if (!value || !String(value).trim()) missing.push(field.label)
    })
  })
  return missing
}
