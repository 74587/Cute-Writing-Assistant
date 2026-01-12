/**
 * 类型定义文件
 */

// 文档类型
export interface Doc {
  id: string           // 唯一标识
  title: string        // 文档标题
  content: string      // 文档内容（HTML格式）
  createdAt: number    // 创建时间戳
  updatedAt: number    // 更新时间戳
}

// 对话消息类型
export interface Message {
  role: 'user' | 'assistant'  // 角色：用户或AI助手
  content: string              // 消息内容
}

// AI设置类型
export interface AISettings {
  apiUrl: string        // API地址（兼容OpenAI格式）
  apiKey: string        // API密钥
  model: string         // 模型名称
  systemPrompt: string  // 自定义系统提示词
}

// 知识库条目类型
export interface KnowledgeEntry {
  id: string                                              // 唯一标识
  category: '人物' | '世界观' | '剧情' | '设定' | '其他'   // 分类
  title: string                                           // 标题
  keywords: string[]                                      // 关键词列表（用于AI自动匹配）
  content: string                                         // 详细内容
}
