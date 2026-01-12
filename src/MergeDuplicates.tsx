import { useState, useMemo } from 'react'
import { useStore } from './store'
import type { KnowledgeEntry, KnowledgeCategory } from './types'
import { createEmptyDetails, CATEGORY_FIELDS } from './types'
import './MergeDuplicates.css'

interface DuplicateGroup {
    baseName: string
    category: KnowledgeCategory
    entries: KnowledgeEntry[]
}

// 提取标题的基础名称（去除编号后缀）
function getBaseName(title: string): string {
    // 移除 (2), (3), （2）, （3） 等后缀
    return title.replace(/\s*[（(]\d+[)）]\s*$/, '').trim()
}

// 查找重复条目
function findDuplicates(knowledge: KnowledgeEntry[]): DuplicateGroup[] {
    const groups = new Map<string, KnowledgeEntry[]>()

    for (const entry of knowledge) {
        const baseName = getBaseName(entry.title)
        const key = `${entry.category}::${baseName}`

        if (!groups.has(key)) {
            groups.set(key, [])
        }
        groups.get(key)!.push(entry)
    }

    // 只返回有多个条目的组
    const duplicates: DuplicateGroup[] = []
    for (const [key, entries] of groups) {
        if (entries.length > 1) {
            const [category, baseName] = key.split('::')
            duplicates.push({
                baseName,
                category: category as KnowledgeCategory,
                entries
            })
        }
    }

    return duplicates.sort((a, b) => b.entries.length - a.entries.length)
}

export function MergeDuplicates({ onClose }: { onClose: () => void }) {
    const { knowledge, aiSettings, addKnowledge, deleteKnowledge } = useStore()
    const [selectedGroup, setSelectedGroup] = useState<number | null>(null)
    const [merging, setMerging] = useState(false)
    const [mergeResult, setMergeResult] = useState<string>('')
    const [error, setError] = useState('')
    const [deleteOriginals, setDeleteOriginals] = useState(false)

    const duplicates = useMemo(() => findDuplicates(knowledge), [knowledge])

    // 合并选中的重复组
    const handleMerge = async (group: DuplicateGroup) => {
        if (!aiSettings.apiKey) {
            setError('请先在 AI设置 中配置 API Key')
            return
        }

        setMerging(true)
        setError('')
        setMergeResult('')

        // 收集所有条目的信息
        const allContent = group.entries.map((entry, i) => {
            const fields = CATEGORY_FIELDS[entry.category]
            const details = fields.map(f => {
                const value = entry.details[f.key]
                return value ? `${f.label}: ${value}` : ''
            }).filter(Boolean).join('\n')

            return `【条目${i + 1}: ${entry.title}】\n关键词: ${entry.keywords.join(', ')}\n${details}`
        }).join('\n\n---\n\n')

        try {
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
                        content: `你是一个专业的小说资料整理专家。请将以下多个关于同一主题的资料条目合并成一个完整、详细的条目。

要求：
1. 整合所有信息，不要遗漏任何细节
2. 去除重复内容，保留独特信息
3. 组织成连贯的描述
4. 如果有矛盾信息，都保留并标注
5. 输出JSON格式，包含以下字段：
   - title: 合并后的标题
   - keywords: 关键词数组
   - content: 合并后的完整内容（至少300字，详细描述）

分类: ${group.category}
主题: ${group.baseName}
条目数量: ${group.entries.length}

原始条目内容：
${allContent}

请返回JSON格式，例如：
{"title": "...", "keywords": ["...", "..."], "content": "..."}`
                    }]
                })
            })

            if (!res.ok) {
                throw new Error(`API 错误: ${res.status}`)
            }

            const data = await res.json()
            const rawContent = data.choices?.[0]?.message?.content || ''

            // 解析 JSON
            const jsonMatch = rawContent.match(/\{[\s\S]*\}/)
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0])

                // 创建新的合并条目
                const mergedDetails = createEmptyDetails(group.category)
                const firstKey = Object.keys(mergedDetails)[0]
                if (firstKey) {
                    mergedDetails[firstKey] = parsed.content || ''
                }

                // 添加到知识库
                addKnowledge({
                    category: group.category,
                    title: parsed.title || `${group.baseName}（合并）`,
                    keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
                    details: mergedDetails
                })

                // 如果选择删除原始条目
                if (deleteOriginals) {
                    for (const entry of group.entries) {
                        deleteKnowledge(entry.id)
                    }
                }

                setMergeResult(`✅ 已成功合并 ${group.entries.length} 个条目为 "${parsed.title}"`)

                // 刷新重复列表
                setSelectedGroup(null)
            } else {
                setError('AI 返回格式错误，请重试')
            }
        } catch (e) {
            setError(`合并失败: ${e instanceof Error ? e.message : '未知错误'}`)
        } finally {
            setMerging(false)
        }
    }

    // 一键合并所有重复
    const handleMergeAll = async () => {
        for (let i = 0; i < duplicates.length; i++) {
            setSelectedGroup(i)
            await handleMerge(duplicates[i])
            // 等待一下避免请求过快
            await new Promise(r => setTimeout(r, 2000))
        }
    }

    return (
        <div className="merge-modal">
            <div className="merge-container">
                <button className="btn-close" onClick={onClose}>×</button>
                <h3>🔄 合并重复条目</h3>

                {duplicates.length === 0 ? (
                    <div className="no-duplicates">
                        <p>✨ 没有发现重复条目！</p>
                        <p className="hint">所有条目的标题都是唯一的。</p>
                    </div>
                ) : (
                    <>
                        <p className="hint">
                            发现 <strong>{duplicates.length}</strong> 组重复条目，
                            共 <strong>{duplicates.reduce((sum, g) => sum + g.entries.length, 0)}</strong> 个条目可合并
                        </p>

                        <div className="merge-options">
                            <label className="checkbox-option">
                                <input
                                    type="checkbox"
                                    checked={deleteOriginals}
                                    onChange={e => setDeleteOriginals(e.target.checked)}
                                />
                                <span>合并后删除原始条目</span>
                            </label>
                        </div>

                        {error && <p className="error-msg">{error}</p>}
                        {mergeResult && <p className="success-msg">{mergeResult}</p>}

                        <div className="duplicate-list">
                            {duplicates.map((group, i) => (
                                <div
                                    key={i}
                                    className={`duplicate-group ${selectedGroup === i ? 'selected' : ''}`}
                                    onClick={() => setSelectedGroup(i)}
                                >
                                    <div className="group-header">
                                        <span className="category-tag">{group.category}</span>
                                        <span className="group-name">{group.baseName}</span>
                                        <span className="group-count">{group.entries.length} 个条目</span>
                                    </div>
                                    <div className="group-entries">
                                        {group.entries.map(entry => (
                                            <span key={entry.id} className="entry-chip">{entry.title}</span>
                                        ))}
                                    </div>
                                    {selectedGroup === i && (
                                        <div className="group-actions">
                                            <button
                                                className="btn-merge"
                                                onClick={(e) => { e.stopPropagation(); handleMerge(group) }}
                                                disabled={merging}
                                            >
                                                {merging ? '合并中...' : '🔗 AI智能合并此组'}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>

                        <div className="merge-footer">
                            <button className="btn-cancel" onClick={onClose}>关闭</button>
                            <button
                                className="btn-merge-all"
                                onClick={handleMergeAll}
                                disabled={merging}
                            >
                                🚀 一键合并全部 ({duplicates.length} 组)
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}
