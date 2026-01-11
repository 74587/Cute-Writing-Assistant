import { useState } from 'react'
import { useStore } from './store'
import mammoth from 'mammoth'
import './LongTextImport.css'

interface ExtractedItem {
  category: '人物' | '世界观' | '剧情' | '设定' | '其他'
  title: string
  keywords: string[]
  content: string
}

// 按章节或段落切分文本，每段不超过 maxLen 字
function splitText(text: string, maxLen = 3000): { content: string; chapter?: string }[] {
  const chunks: { content: string; chapter?: string }[] = []
  
  // 匹配章节标题
  const chapterPattern = /(第[一二三四五六七八九十百千\d]+章[^\n]*|Chapter\s*\d+[^\n]*)/gi
  const parts = text.split(chapterPattern)
  
  let currentChapter = ''
  
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim()
    if (!part) continue
    
    // 检查是否是章节标题
    if (chapterPattern.test(part)) {
      chapterPattern.lastIndex = 0 // 重置正则
      currentChapter = part
      continue
    }
    
    if (part.length < 50) continue
    
    if (part.length <= maxLen) {
      chunks.push({ content: part, chapter: currentChapter || undefined })
    } else {
      // 内容太长，按段落再分
      const paragraphs = part.split(/\n\n+/)
      let current = ''
      for (const p of paragraphs) {
        if ((current + p).length > maxLen && current) {
          chunks.push({ content: current.trim(), chapter: currentChapter || undefined })
          current = p
        } else {
          current += '\n\n' + p
        }
      }
      if (current.trim().length > 50) {
        chunks.push({ content: current.trim(), chapter: currentChapter || undefined })
      }
    }
  }
  
  return chunks
}

export function LongTextImport({ onClose }: { onClose: () => void }) {
  const { aiSettings, addKnowledge } = useStore()
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [results, setResults] = useState<ExtractedItem[]>([])
  const [error, setError] = useState('')

  // 读取文件
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setError('')
    
    if (file.name.endsWith('.txt')) {
      const content = await file.text()
      setText(content)
    } else if (file.name.endsWith('.docx') || file.name.endsWith('.doc')) {
      try {
        const arrayBuffer = await file.arrayBuffer()
        const result = await mammoth.extractRawText({ arrayBuffer })
        setText(result.value)
      } catch {
        setError('Word 文件读取失败，请尝试另存为 .docx 格式')
      }
    } else {
      setError('只支持 .txt 和 .docx 文件')
    }
  }

  const handleAnalyze = async () => {
    if (!text.trim()) return
    if (!aiSettings.apiKey) {
      setError('请先在 AI设置 中配置 API Key')
      return
    }

    const chunks = splitText(text)
    setProgress({ current: 0, total: chunks.length })
    setLoading(true)
    setError('')
    
    const allResults: ExtractedItem[] = []

    for (let i = 0; i < chunks.length; i++) {
      setProgress({ current: i + 1, total: chunks.length })
      
      try {
        const chapterHint = chunks[i].chapter ? `\n当前章节：${chunks[i].chapter}` : ''
        const res = await fetch(aiSettings.apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${aiSettings.apiKey}`,
          },
          body: JSON.stringify({
            model: aiSettings.model,
            messages: [{
              role: 'user',
              content: `分析以下小说片段，提取其中的人物、世界观、重要剧情、设定等信息。
如果没有明显的设定信息可以跳过。
返回JSON数组格式：[{"category":"人物|世界观|剧情|设定|其他","title":"名称","keywords":["关键词"],"content":"详细描述"}]
只返回JSON数组，不要其他内容。如果没有可提取的内容，返回空数组 []
${chapterHint}
文本片段：
${chunks[i].content}`
            }]
          })
        })
        
        const data = await res.json()
        const content = data.choices?.[0]?.message?.content || '[]'
        const match = content.match(/\[[\s\S]*\]/)
        if (match) {
          const items = JSON.parse(match[0]) as ExtractedItem[]
          allResults.push(...items)
        }
      } catch (e) {
        console.error('分析第', i + 1, '段失败:', e)
      }
      
      // 避免请求太快
      await new Promise(r => setTimeout(r, 500))
    }

    setResults(allResults)
    setLoading(false)
  }

  // 合并相同标题的条目
  const mergedResults = results.reduce((acc, item) => {
    const existing = acc.find(a => a.title === item.title && a.category === item.category)
    if (existing) {
      existing.content += '\n\n' + item.content
      existing.keywords = [...new Set([...existing.keywords, ...item.keywords])]
    } else {
      acc.push({ ...item })
    }
    return acc
  }, [] as ExtractedItem[])

  const handleImport = () => {
    mergedResults.forEach(item => {
      addKnowledge({
        category: item.category,
        title: item.title,
        keywords: item.keywords,
        content: item.content
      })
    })
    onClose()
  }

  return (
    <div className="long-import-modal">
      <div className="long-import-container">
        <button className="btn-close" onClick={onClose}>x</button>
        <h3>长文分析导入</h3>
        
        {results.length === 0 ? (
          <>
            <p className="hint">
              导入小说文件或粘贴内容（支持10万字以上），系统会自动分段让 AI 逐段分析，提取人物、设定等信息。
            </p>
            <div className="file-select">
              <label className="file-btn">
                选择文件 (TXT/Word)
                <input type="file" accept=".txt,.doc,.docx" onChange={handleFileSelect} hidden />
              </label>
              <span className="file-hint">或直接在下方粘贴文本</span>
            </div>
            <textarea
              className="long-input"
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="粘贴小说内容..."
              disabled={loading}
            />
            {error && <p className="error-msg">{error}</p>}
            <div className="long-footer">
              <span className="char-count">{text.length.toLocaleString()} 字</span>
              {loading ? (
                <span className="progress">
                  正在分析第 {progress.current}/{progress.total} 段...
                </span>
              ) : (
                <button className="btn-analyze" onClick={handleAnalyze} disabled={!text.trim()}>
                  开始分析
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="hint">
              分析完成，共提取 {mergedResults.length} 个条目（已自动合并相同项）
            </p>
            <div className="result-list">
              {mergedResults.map((item, i) => (
                <div key={i} className="result-item">
                  <div className="result-header">
                    <span className="category-tag">{item.category}</span>
                    <span className="result-title">{item.title}</span>
                  </div>
                  <div className="result-keywords">关键词: {item.keywords.join(', ')}</div>
                  <div className="result-preview">{item.content.slice(0, 150)}...</div>
                </div>
              ))}
            </div>
            <div className="long-footer">
              <button className="btn-back" onClick={() => setResults([])}>重新分析</button>
              <button className="btn-import" onClick={handleImport}>
                全部导入知识库 ({mergedResults.length})
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
