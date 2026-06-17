import { useState, useEffect } from 'react'
import { useProjectsStore } from '../store/useProjectsStore'
import type { DbProject } from '../lib/supabase'

interface Props {
  onSelect: (project: DbProject) => void
  activeId: string | null
}

export function ProjectsPanel({ onSelect, activeId }: Props) {
  const { projects, loading, fetchProjects, createProject, renameProject, deleteProject } = useProjectsStore()
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  useEffect(() => { fetchProjects() }, [])

  const handleCreate = async () => {
    const name = newName.trim() || 'Новый объект'
    const p = await createProject(name)
    if (p) { setNewName(''); onSelect(p) }
  }

  const handleRename = async (id: string) => {
    if (editName.trim()) await renameProject(id, editName.trim())
    setEditingId(null)
  }

  const s: Record<string, React.CSSProperties> = {
    panel: {
      width: 240, borderRight: '1px solid #ddd', background: '#f8f9fa',
      display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
    },
    header: {
      padding: '12px 14px', borderBottom: '1px solid #ddd',
      fontSize: 13, fontWeight: 700, color: '#444', background: '#eef0f3',
    },
    list: { flex: 1, overflowY: 'auto', padding: '6px 0' },
    itemActive: {
      padding: '8px 14px', cursor: 'pointer', fontSize: 13,
      background: '#e3ecfa',
      borderLeft: '3px solid #3a7bd5',
      display: 'flex', alignItems: 'center', gap: 6,
    },
    itemInactive: {
      padding: '8px 14px', cursor: 'pointer', fontSize: 13,
      background: 'transparent',
      borderLeft: '3px solid transparent',
      display: 'flex', alignItems: 'center', gap: 6,
    },
    itemName: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    editInput: {
      flex: 1, fontSize: 13, border: '1px solid #3a7bd5', borderRadius: 4,
      padding: '2px 6px', outline: 'none',
    },
    iconBtn: {
      background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
      color: '#999', fontSize: 14, lineHeight: 1,
    },
    footer: { padding: '10px 14px', borderTop: '1px solid #ddd' },
    newInput: {
      width: '100%', padding: '7px 10px', border: '1px solid #ccc',
      borderRadius: 6, fontSize: 13, boxSizing: 'border-box', marginBottom: 6,
    },
    addBtn: {
      width: '100%', padding: '7px', background: '#3a7bd5', color: '#fff',
      border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    },
  }

  return (
    <div style={s.panel}>
      <div style={s.header}>📁 Объекты</div>
      <div style={s.list}>
        {loading && <div style={{ padding: '10px 14px', color: '#aaa', fontSize: 12 }}>Загрузка...</div>}
        {!loading && projects.length === 0 && (
          <div style={{ padding: '10px 14px', color: '#aaa', fontSize: 12 }}>Нет объектов</div>
        )}
        {projects.map(p => (
          <div key={p.id} style={p.id === activeId ? s.itemActive : s.itemInactive} onClick={() => onSelect(p)}>
            {editingId === p.id
              ? <input
                  style={s.editInput}
                  value={editName}
                  autoFocus
                  onChange={e => setEditName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleRename(p.id)
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  onBlur={() => handleRename(p.id)}
                  onClick={e => e.stopPropagation()}
                />
              : <span style={s.itemName}>{p.name}</span>
            }
            {editingId !== p.id && <>
              <button style={s.iconBtn} title="Переименовать"
                onClick={e => { e.stopPropagation(); setEditingId(p.id); setEditName(p.name) }}>
                ✏️
              </button>
              <button style={s.iconBtn} title="Удалить"
                onClick={e => {
                  e.stopPropagation()
                  if (confirm(`Удалить объект «${p.name}»?`)) deleteProject(p.id)
                }}>
                🗑️
              </button>
            </>}
          </div>
        ))}
      </div>
      <div style={s.footer}>
        <input
          style={s.newInput}
          placeholder="Название объекта"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleCreate()}
        />
        <button style={s.addBtn} onClick={handleCreate}>+ Новый объект</button>
      </div>
    </div>
  )
}
