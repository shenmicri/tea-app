/**
 * 字段定义的唯一来源。
 * 表单页（pages/edit）与档案页（pages/archive）都从这里渲染，页面里不写死任何字段。
 *
 * 字段属性：
 *   key      存进 archive.sections[sectionKey][fieldKey]，同一区块内唯一。改 key 属破坏性改动。
 *   label    表单与档案页共用的显示名，随便改。
 *   type     'text' | 'textarea' | 'picker' | 'images' 四选一。
 *   required 目前只有基本信息里的「茶名」为 true。
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
        options: ['绿茶', '白茶', '黄茶', '青茶（乌龙）', '红茶', '黑茶', '再加工茶', '其他']
      },
      { key: 'variety', label: '具体品种或小类', type: 'text' },
      { key: 'summary', label: '一句话介绍', type: 'textarea' },
      { key: 'code', label: '产品编号', type: 'text' }
    ]
  },
  {
    key: 'feature',
    title: '茶的特点、制作与使用',
    fields: [
      { key: 'appearance', label: '干茶外形', type: 'text' },
      { key: 'aroma', label: '香气', type: 'text' },
      { key: 'liquor', label: '汤色', type: 'text' },
      { key: 'taste', label: '滋味', type: 'text' },
      { key: 'leaf', label: '叶底', type: 'text' },
      { key: 'craft', label: '制作工艺', type: 'textarea' },
      { key: 'brewing', label: '冲泡建议', type: 'textarea' },
      { key: 'storage', label: '储存方式', type: 'text' },
      { key: 'caution', label: '特别注意事项', type: 'textarea' },
      { key: 'images', label: '图片', type: 'images' }
    ]
  },
  {
    key: 'origin',
    title: '产地、环境与原料',
    fields: [
      { key: 'region', label: '产地', type: 'textarea' },
      { key: 'garden', label: '茶区／山场／茶园', type: 'text' },
      { key: 'cultivar', label: '茶树品种', type: 'text' },
      { key: 'treeAge', label: '树龄', type: 'text' },
      { key: 'environment', label: '生长环境', type: 'textarea' },
      { key: 'planting', label: '种植方式', type: 'text' },
      { key: 'pickingTime', label: '采摘时间或季节', type: 'text' },
      { key: 'pickingStandard', label: '采摘标准', type: 'text' },
      { key: 'images', label: '图片', type: 'images' }
    ]
  },
  {
    key: 'culture',
    title: '历史、文化与故事',
    fields: [
      { key: 'history', label: '历史与文化背景', type: 'textarea' },
      { key: 'legend', label: '传统故事', type: 'textarea' },
      { key: 'makerStory', label: '茶园或制茶人故事', type: 'textarea' },
      { key: 'images', label: '图片', type: 'images' }
    ]
  },
  {
    key: 'brand',
    title: '品牌、卖家与茶农信息',
    fields: [
      { key: 'brandName', label: '品牌或店铺名称', type: 'text' },
      { key: 'producer', label: '生产者介绍', type: 'textarea' },
      { key: 'contact', label: '联系方式', type: 'text' },
      { key: 'address', label: '地址', type: 'text' },
      { key: 'website', label: '官方网站', type: 'text' },
      { key: 'images', label: '图片', type: 'images' }
    ]
  }
]

/** 按 schema 生成一份全空的 sections，字段一律为空字符串或空数组。 */
export function createEmptySections() {
  const sections = {}
  SECTIONS.forEach(section => {
    sections[section.key] = {}
    section.fields.forEach(field => {
      sections[section.key][field.key] = field.type === 'images' ? [] : ''
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
