import { useState, useEffect } from 'react'
import { useProjectMembersStore } from '../store/useProjectMembersStore'
import { ROLE_LABEL, ASSIGNABLE_ROLES, type DbProjectMember } from '../lib/projectMembers'
import { can, canManageMember, findMember, type ProjectMember, type ProjectRole } from '../core/permissions'

interface Props {
  projectId: string
  currentUserId: string
  currentUserEmail?: string | null
  onClose: () => void
}

// Приводит строку из Supabase (snake_case) к форме, которую ждёт permissions.ts
function toProjectMember(m: DbProjectMember): ProjectMember {
  return {
    id: m.id,
    projectId: m.project_id,
    userId: m.user_id,
    invitedEmail: m.invited_email,
    role: m.role,
    specialty: m.specialty,
    isTeamLead: m.is_team_lead,
    teamLeadId: m.team_lead_id,
    status: m.status,
    invitedBy: m.invited_by,
    createdAt: m.created_at,
  }
}

export function ProjectMembersPanel({ projectId, currentUserId, currentUserEmail, onClose }: Props) {
  const { members, loading, error, load, invite, setRole, remove, transferTo, clearError } = useProjectMembersStore()

  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<ProjectRole>('installer')
  const [inviteSpecialty, setInviteSpecialty] = useState('')
  const [inviting, setInviting] = useState(false)

  const [transferTargetId, setTransferTargetId] = useState<string | null>(null)

  useEffect(() => { load(projectId) }, [projectId])

  const asProjectMembers = members.map(toProjectMember)
  const me = findMember(asProjectMembers, currentUserId)
  const isOwner = me?.role === 'owner'

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return
    const iAmTeamLead = me?.role === 'subcontractor' && me.isTeamLead
    setInviting(true)
    const ok = await invite({
      projectId,
      email: inviteEmail,
      role: iAmTeamLead ? 'subcontractor' : inviteRole,
      specialty: inviteSpecialty.trim() || undefined,
      invitedBy: currentUserId,
      teamLeadId: iAmTeamLead ? me.id : undefined,
    })
    setInviting(false)
    if (ok) {
      setInviteEmail(''); setInviteSpecialty(''); setInviteRole('installer'); setShowInvite(false)
    }
  }

  const handleTransfer = async () => {
    if (!me || !transferTargetId) return
    if (!confirm('После передачи прав вы перестанете быть владельцем объекта. Продолжить?')) return
    await transferTo(me.id, transferTargetId, 'foreman')
    setTransferTargetId(null)
  }

  const s: Record<string, React.CSSProperties> = {
    overlay: {
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    },
    box: {
      background: '#fff', borderRadius: 10, width: 520, maxHeight: '80vh',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      boxShadow: '0 8px 30px rgba(0,0,0,0.2)',
    },
    header: {
      padding: '14px 18px', borderBottom: '1px solid #e5e5e5',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    },
    title: { fontSize: 15, fontWeight: 700, color: '#333' },
    closeBtn: { border: 'none', background: 'none', fontSize: 18, color: '#888', cursor: 'pointer' },
    list: { flex: 1, overflowY: 'auto', padding: '6px 0' },
    row: {
      padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 10,
      borderBottom: '1px solid #f0f0f0', fontSize: 13,
    },
    nameCol: { flex: 1, minWidth: 0 },
    email: { color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    meta: { color: '#999', fontSize: 11, marginTop: 2 },
    roleSelect: {
      padding: '4px 6px', borderRadius: 6, border: '1px solid #ddd', fontSize: 12, color: '#333',
    },
    roleStatic: { fontSize: 12, color: '#555', padding: '4px 6px' },
    iconBtn: { border: 'none', background: 'none', cursor: 'pointer', color: '#c0392b', fontSize: 13 },
    footer: { padding: '12px 18px', borderTop: '1px solid #e5e5e5' },
    addBtn: {
      width: '100%', padding: '9px', background: '#3a7bd5', color: '#fff',
      border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    },
    inviteForm: { padding: '12px 18px', borderTop: '1px solid #e5e5e5', background: '#f8f9fa' },
    input: {
      width: '100%', padding: '7px 10px', border: '1px solid #ccc', borderRadius: 6,
      fontSize: 13, boxSizing: 'border-box', marginBottom: 8,
    },
    select: {
      width: '100%', padding: '7px 10px', border: '1px solid #ccc', borderRadius: 6,
      fontSize: 13, boxSizing: 'border-box', marginBottom: 8,
    },
    inviteActions: { display: 'flex', gap: 8 },
    errorBox: { color: '#c0392b', fontSize: 12, padding: '0 18px 8px' },
    badge: {
      fontSize: 10, color: '#fff', background: '#999', borderRadius: 4, padding: '1px 5px', marginLeft: 6,
    },
  }

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.box} onClick={e => e.stopPropagation()}>
        <div style={s.header}>
          <span style={s.title}>👥 Участники объекта</span>
          <button style={s.closeBtn} onClick={onClose} aria-label="Закрыть">✕</button>
        </div>

        {error && (
          <div style={s.errorBox}>
            {error} <button style={{ border: 'none', background: 'none', color: '#3a7bd5', cursor: 'pointer', fontSize: 12 }} onClick={clearError}>скрыть</button>
          </div>
        )}

        <div style={s.list}>
          {loading && <div style={{ padding: 14, color: '#aaa', fontSize: 12 }}>Загрузка...</div>}
          {!loading && members.length === 0 && (
            <div style={{ padding: 14, color: '#aaa', fontSize: 12 }}>Пока нет участников</div>
          )}
          {members.map(m => {
            const asMember = toProjectMember(m)
            const iCanManage = me ? canManageMember(me, asMember) : false
            const isMe = m.user_id === currentUserId
            return (
              <div key={m.id} style={s.row}>
                <div style={s.nameCol}>
                  <div style={s.email}>
                    {m.invited_email ?? (isMe ? currentUserEmail : null) ?? m.user_id ?? '—'}
                    {isMe && <span style={s.badge}>вы</span>}
                    {m.status === 'invited' && <span style={s.badge} title="Ожидает первого входа">приглашён</span>}
                    {m.is_team_lead && <span style={s.badge} title="Прораб субподрядчика">team lead</span>}
                  </div>
                  {m.specialty && <div style={s.meta}>{m.specialty}</div>}
                </div>

                {iCanManage && m.role !== 'owner' ? (
                  <select
                    style={s.roleSelect}
                    value={m.role}
                    onChange={e => setRole(m.id, e.target.value as ProjectRole)}
                  >
                    {ASSIGNABLE_ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                ) : (
                  <span style={s.roleStatic}>{ROLE_LABEL[m.role]}</span>
                )}

                {isOwner && m.role !== 'owner' && (
                  <button
                    style={{ ...s.roleSelect, cursor: 'pointer', color: '#3a7bd5', border: '1px solid #3a7bd5' }}
                    onClick={() => setTransferTargetId(m.id)}
                    title="Передать права владельца этому участнику"
                  >
                    Сделать владельцем
                  </button>
                )}

                {iCanManage && m.role !== 'owner' && (
                  <button
                    style={s.iconBtn}
                    title="Убрать с объекта"
                    onClick={() => { if (confirm('Убрать участника с объекта?')) remove(m.id) }}
                  >
                    🗑️
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {transferTargetId && (
          <div style={{ ...s.inviteForm, background: '#fff7e6' }}>
            <p style={{ fontSize: 12, color: '#7a5a20', margin: '0 0 8px' }}>
              Передать права владельца участнику «
              {members.find(m => m.id === transferTargetId)?.invited_email ?? members.find(m => m.id === transferTargetId)?.user_id}
              »? Вы получите роль «Прораб».
            </p>
            <div style={s.inviteActions}>
              <button style={s.addBtn} onClick={handleTransfer}>Подтвердить передачу</button>
              <button style={{ ...s.addBtn, background: '#999' }} onClick={() => setTransferTargetId(null)}>Отмена</button>
            </div>
          </div>
        )}

        {me && can(me.role, 'manageMembers') || (me?.role === 'subcontractor' && me.isTeamLead) ? (
          showInvite ? (
            <div style={s.inviteForm}>
              <input
                style={s.input}
                type="email"
                placeholder="Email участника"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                autoFocus
              />
              {!(me?.role === 'subcontractor' && me.isTeamLead) && (
                <select style={s.select} value={inviteRole} onChange={e => setInviteRole(e.target.value as ProjectRole)}>
                  {ASSIGNABLE_ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
              )}
              <input
                style={s.input}
                placeholder="Специальность (необязательно): плиточник, электрик..."
                value={inviteSpecialty}
                onChange={e => setInviteSpecialty(e.target.value)}
              />
              <div style={s.inviteActions}>
                <button style={s.addBtn} onClick={handleInvite} disabled={inviting}>
                  {inviting ? '...' : 'Пригласить'}
                </button>
                <button style={{ ...s.addBtn, background: '#999' }} onClick={() => setShowInvite(false)}>Отмена</button>
              </div>
            </div>
          ) : (
            <div style={s.footer}>
              <button style={s.addBtn} onClick={() => setShowInvite(true)}>+ Добавить участника</button>
            </div>
          )
        ) : null}
      </div>
    </div>
  )
}
