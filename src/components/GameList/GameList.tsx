/**
 * 棋谱列表组件
 *
 * 支持:
 *   - 文件浏览/上传 PGN
 *   - 拖拽上传
 *   - 文本粘贴导入
 *   - 最近棋谱 / 胜负筛选 / 收藏
 *   - 删除
 */

import React, { useState, useRef, useCallback } from 'react'
import { useStore } from '../../store/useStore'
import type { Game } from '../../game/model'
import { parsePGN, splitPGNGames } from '../../game/pgn'
import {
  saveGame as storageSaveGame, toggleStar as storageToggleStar,
  exportAllGames, importAllGames, getStorageUsage,
} from '../../game/storage'

export const GameList: React.FC = () => {
  const savedGames = useStore(s => s.savedGames)
  const loadGame = useStore(s => s.loadGame)
  const deleteGameById = useStore(s => s.deleteGameById)
  const refreshSavedGames = useStore(s => s.refreshSavedGames)
  const setTab = useStore(s => s.setTab)
  const showToast = useStore(s => s.showToast)

  const [filter, setFilter] = useState<'all' | 'starred' | 'wins' | 'losses' | 'draws'>('all')
  const [query, setQuery] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState('')
  const [isDragging, setIsDragging] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const backupInputRef = useRef<HTMLInputElement>(null)

  const usage = getStorageUsage()
  const usagePct = Math.round((usage.bytes / usage.limitBytes) * 100)
  const usageKB = Math.max(1, Math.round(usage.bytes / 1024))

  /** 导出全部备份 */
  const handleBackup = () => {
    const json = exportAllGames()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `xiangqi_backup_${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    showToast('已导出全部棋谱备份')
  }

  /** 从 JSON 备份恢复 */
  const handleRestoreFile = async (file: File) => {
    try {
      const text = await file.text()
      const added = importAllGames(text)
      refreshSavedGames()
      showToast(added > 0 ? `恢复完成，新增 ${added} 局` : '备份中的棋谱均已存在')
    } catch {
      showToast('⚠ 备份文件无法读取')
    }
  }

  const filtered = savedGames.filter(g => {
    if (filter === 'starred') return g.starred
    if (filter === 'wins') return g.result === '1-0'
    if (filter === 'losses') return g.result === '0-1'
    if (filter === 'draws') return g.result === '1/2-1/2'
    return true
  }).filter(g => {
    if (!query.trim()) return true
    const q = query.trim().toLowerCase()
    return (
      (g.header.Red || '').toLowerCase().includes(q) ||
      (g.header.Black || '').toLowerCase().includes(q) ||
      (g.header.Event || '').toLowerCase().includes(q) ||
      (g.header.Date || '').includes(q)
    )
  })

  /** 收藏/取消收藏（计划第7.2节） */
  const handleToggleStar = (id: string) => {
    storageToggleStar(id)
    refreshSavedGames()
  }

  const formatDate = (ts: number) => {
    const d = new Date(ts)
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  const getResultIcon = (result: string) => {
    if (result === '1-0') return '✓ 红胜'
    if (result === '0-1') return '✗ 黑胜'
    if (result === '1/2-1/2') return '½ 和棋'
    return '… 进行中'
  }

  const getResultClass = (result: string) => {
    if (result === '1-0') return 'result-win'
    if (result === '0-1') return 'result-loss'
    return 'result-draw'
  }

  // ── PGN 导入逻辑 ──────────────────────────────────────────────

  const handleImportText = () => {
    if (!importText.trim()) return
    setImportError('')
    const result = parsePGN(importText)
    if (result.success && result.game) {
      storageSaveGame(result.game)
      refreshSavedGames()
      loadGame(result.game.id)
      setImportText('')
      setShowImport(false)
      showToast('已导入 1 局棋谱，正在复盘浏览')
    } else {
      setImportError(result.error || '导入失败')
    }
  }

  /** 导入多局文本并载入最后一局 */
  const importGamesText = useCallback((text: string) => {
    const chunks = splitPGNGames(text)
    let imported = 0
    let lastGame: Game | null = null
    let firstError = ''

    for (const chunk of chunks) {
      const result = parsePGN(chunk)
      if (result.success && result.game) {
        storageSaveGame(result.game)
        lastGame = result.game
        imported++
      } else if (!firstError) {
        firstError = result.error || ''
      }
    }

    if (imported > 0 && lastGame) {
      refreshSavedGames()
      loadGame(lastGame.id)
      setTab('play')
      setShowImport(false)
      showToast(
        imported === 1
          ? '已导入 1 局棋谱，正在复盘浏览'
          : `成功导入 ${imported} 局棋谱（已打开最后一局）`,
      )
    } else {
      setImportError(firstError || '未能解析任何有效棋谱')
      setShowImport(true) // 展示错误详情
    }
  }, [refreshSavedGames, loadGame, setTab, showToast])

  /** 读文件: UTF-8 失败自动回退 GBK（国内棋谱常见编码） */
  const readFileText = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const buf = reader.result as ArrayBuffer
        try {
          // strict 模式探测 UTF-8，含非法字节则回退 GBK
          resolve(new TextDecoder('utf-8', { fatal: true }).decode(buf))
        } catch {
          try {
            resolve(new TextDecoder('gbk').decode(buf))
          } catch {
            reject(new Error('无法识别文件编码'))
          }
        }
      }
      reader.onerror = () => reject(new Error('读取文件失败'))
      reader.readAsArrayBuffer(file)
    })

  const handleFileUpload = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return
    setImportError('')

    const file = files[0]
    if (!/\.(pgn|txt)$/i.test(file.name)) {
      setImportError('请选择 .pgn 或 .txt 文件')
      return
    }

    readFileText(file)
      .then(text => {
        if (!text.trim()) { setImportError('文件为空'); return }
        importGamesText(text)
      })
      .catch(e => setImportError(e.message))
  }, [importGamesText])

  // 拖拽处理
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    handleFileUpload(e.dataTransfer.files)
  }, [handleFileUpload])

  return (
    <div className="game-list"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{ position: 'relative' }}>

      {/* 拖拽覆盖层 */}
      {isDragging && (
        <div className="drag-overlay">
          <div className="drag-overlay-text">📄 拖放 PGN 文件到这里</div>
        </div>
      )}

      <div className="panel-header">
        <h3>棋谱</h3>
        <div className="storage-actions">
          <button className="btn btn-sm" title="导出全部棋谱为 JSON 备份" onClick={handleBackup}>💾 备份</button>
          <button className="btn btn-sm" title="从 JSON 备份恢复" onClick={() => backupInputRef.current?.click()}>📥 恢复</button>
        </div>
      </div>

      {/* 隐藏的备份恢复输入 */}
      <input ref={backupInputRef} type="file" accept=".json" data-backup-input="1"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) handleRestoreFile(f)
          e.target.value = ''
        }} />

      {/* 容量占用 */}
      <div className={`storage-line ${usagePct > 80 ? 'storage-warn' : ''}`}>
        <span>共 {usage.games} 局 · 约 {usageKB} KB{usagePct > 80 ? ' · 空间告急，建议备份' : ''}</span>
      </div>

      {/* 导入按钮 */}
      <div className="controls-row" style={{ marginBottom: 8 }}>
        <button className="btn btn-sm" onClick={() => fileInputRef.current?.click()}>📂 浏览文件</button>
        <button className="btn btn-sm" onClick={() => setShowImport(!showImport)}>📝 粘贴导入</button>
      </div>

      {/* PGN 文件输入 */}
      <input ref={fileInputRef} type="file" accept=".pgn,.txt" data-pgn-input="1"
        style={{ display: 'none' }}
        onChange={(e) => {
          handleFileUpload(e.target.files)
          e.target.value = '' // 允许重复选择同一文件
        }} />

      {/* 文本粘贴导入 */}
      {showImport && (
        <div className="import-panel">
          <textarea
            value={importText}
            onChange={e => { setImportText(e.target.value); setImportError('') }}
            placeholder={'粘贴 PGN 棋谱...\n\n[Event "对局"]\n[Red "红方"]\n[Black "黑方"]\n\n1. 炮二平五 马2进3\n2. 马二进三 ...'}
            rows={10}
            className="import-textarea"
          />
          {importError && (
            <div className="import-error">{importError}</div>
          )}
          <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
            <button className="btn btn-sm btn-active" onClick={handleImportText} disabled={!importText.trim()}>导入</button>
            <button className="btn btn-sm" onClick={() => { setShowImport(false); setImportText(''); setImportError('') }}>取消</button>
          </div>
        </div>
      )}

      {/* 搜索框（计划第7.2节） */}
      <input
        className="search-input"
        placeholder="搜索对手 / 赛事 / 日期…"
        value={query}
        onChange={e => setQuery(e.target.value)}
      />

      {/* 筛选按钮 */}
      <div className="controls-row" style={{ marginBottom: 8 }}>
        {(['all', 'starred', 'wins', 'losses', 'draws'] as const).map(f => (
          <button key={f} className={`btn btn-sm ${filter === f ? 'btn-active' : ''}`}
            onClick={() => setFilter(f)}>
            {f === 'all' ? '全部' : f === 'starred' ? '★ 收藏' : f === 'wins' ? '胜' : f === 'losses' ? '负' : '和'}
          </button>
        ))}
      </div>

      {/* 棋谱列表 */}
      <div className="game-list-items">
        {filtered.length === 0 ? (
          <div className="panel-hint" style={{ padding: 20, textAlign: 'center' }}>
            {savedGames.length === 0
              ? '暂无棋谱\n\n点击「浏览文件」导入 PGN，或拖放文件到这里'
              : '无匹配棋谱'}
          </div>
        ) : (
          filtered.map(game => (
            <div key={game.id} className="game-item" onClick={() => loadGame(game.id)}>
              <div className="game-item-left">
                <span className={`game-result ${getResultClass(game.result)}`}>
                  {getResultIcon(game.result)}
                </span>
                <div className="game-item-info">
                  <div className="game-item-players">
                    {game.header.Red || '红'} vs {game.header.Black || '黑'}
                  </div>
                  <div className="game-item-meta">
                    {game.plies.length}步 · {game.header.Event || game.header.Date || formatDate(game.createdAt)}
                  </div>
                </div>
              </div>
              <div className="game-item-right" onClick={e => e.stopPropagation()}>
                <button
                  className={`btn-icon ${game.starred ? 'starred' : ''}`}
                  title={game.starred ? '取消收藏' : '收藏'}
                  onClick={() => handleToggleStar(game.id)}
                >
                  {game.starred ? '★' : '☆'}
                </button>
                <button className="btn-icon" title="删除"
                  onClick={() => { if (confirm('确定删除这局棋谱？')) deleteGameById(game.id) }}>
                  🗑
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div style={{ padding: '8px 0', fontSize: 12, color: '#888' }}>
        共 {savedGames.length} 局棋谱
      </div>
    </div>
  )
}
