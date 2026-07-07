import { useState } from 'react'
import { supabase } from '../lib/supabase'

type Mode = 'login' | 'register' | 'phone' | 'phone_otp'

interface AuthModalProps {
  onClose: () => void
}

// Окно входа: тёмный экран, лампа на проводе, квадратный выключатель слева.
// Пока выключатель выключен — поля скрыты (только лампа и подсказка).
// Щёлкнули по выключателю — лампа загорается тёплым светом, появляется
// табличка «ВХОД» и поля. Успешный вход/регистрация закрывают окно.
// Дизайн утверждён пользователем 07.07.2026 (см. прототипы в чате).
export function AuthModal({ onClose }: AuthModalProps) {
  const [isOn, setIsOn] = useState(false)
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleEmailAuth = async () => {
    setError(null)
    setLoading(true)
    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
      else onClose()
    } else {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) setError(error.message)
      else setInfo('Письмо с подтверждением отправлено на ' + email)
    }
    setLoading(false)
  }

  const handlePhoneSend = async () => {
    setError(null)
    setLoading(true)
    const { error } = await supabase.auth.signInWithOtp({ phone })
    if (error) setError(error.message)
    else { setInfo('Код отправлен на ' + phone); setMode('phone_otp') }
    setLoading(false)
  }

  const handlePhoneVerify = async () => {
    setError(null)
    setLoading(true)
    const { error } = await supabase.auth.verifyOtp({ phone, token: otp, type: 'sms' })
    if (error) setError(error.message)
    else onClose()
    setLoading(false)
  }

  const s: Record<string, React.CSSProperties> = {
    overlay: {
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    },
    box: {
      position: 'relative', background: isOn ? '#241f18' : '#141210', borderRadius: 12,
      width: 340, height: 480, overflow: 'hidden', border: '0.5px solid #2a2a2a',
      transition: 'background 0.6s',
    },
    input: {
      width: '100%', padding: '8px 10px', border: '0.5px solid #444', background: '#1c1c1c',
      color: '#eee', borderRadius: 6, fontSize: 14, boxSizing: 'border-box', marginBottom: 8,
    },
    btn: {
      width: '100%', padding: '9px', background: '#1c1c1c', color: '#eee',
      border: '0.5px solid #666', borderRadius: 6, fontSize: 14, fontWeight: 600,
      cursor: 'pointer', marginBottom: 8,
    },
    ghost: {
      width: '100%', padding: '8px', background: 'transparent', color: '#999',
      border: 'none', fontSize: 12, cursor: 'pointer', marginTop: 2,
    },
    error: { color: '#d98a8a', fontSize: 12, marginBottom: 6, textAlign: 'center' },
    info: { color: '#8fcf7a', fontSize: 12, marginBottom: 6, textAlign: 'center' },
  }

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.box} onClick={e => e.stopPropagation()}>
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: 12, right: 16, border: 'none', background: 'transparent',
            fontSize: 18, color: '#888', cursor: 'pointer', lineHeight: 1, zIndex: 2,
          }}
          aria-label="Закрыть"
        >✕</button>

        {/* ─── Лампа на проводе ─── */}
        <div style={{
          position: 'absolute', top: 0, left: '50%', transformOrigin: 'top center',
          animation: 'wc-auth-sway 3.6s ease-in-out infinite',
        }}>
          <div style={{ width: 2, height: 64, background: '#3a3a3a', margin: '0 auto' }} />
          <svg width="64" height="76" viewBox="0 0 72 86" style={{ display: 'block', margin: '-2px auto 0' }}>
            <rect x="30" y="0" width="12" height="7" fill="#8a8a8a" />
            <rect x="27" y="6" width="18" height="14" rx="2" fill="#8f8f8f" />
            <line x1="27" y1="10" x2="45" y2="10" stroke="#6b6b6b" strokeWidth="1" />
            <line x1="27" y1="13" x2="45" y2="13" stroke="#6b6b6b" strokeWidth="1" />
            <line x1="27" y1="16" x2="45" y2="16" stroke="#6b6b6b" strokeWidth="1" />
            <rect x="29" y="19" width="14" height="4" fill="#3d3d3d" />
            <ellipse cx="36" cy="53" rx="30" ry="29"
              fill={isOn ? '#f0b854' : '#2c2a28'} fillOpacity={isOn ? 0.85 : 0.55}
              stroke="#4a4744" strokeWidth="1" style={{ transition: 'fill 0.4s, fill-opacity 0.4s' }} />
            <path
              d="M28 40 L28 58 M28 40 L36 46 M36 46 L28 52 M28 52 L36 58 M36 46 L44 40 M44 40 L44 58 M44 58 L36 52 M36 52 L44 46"
              stroke={isOn ? '#e08a2e' : '#7a5a2e'} strokeWidth="1.4" fill="none" strokeLinejoin="round"
              style={{ transition: 'stroke 0.4s' }} />
          </svg>
        </div>

        {/* ─── Выключатель: квадратный, слева, ниже центра ─── */}
        <div
          onClick={() => setIsOn(v => !v)}
          style={{
            position: 'absolute', left: 18, top: 300, width: 56, height: 56,
            background: '#e4e2dc', borderRadius: 6, border: '0.5px solid #c9c7c0',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}
        >
          <div style={{
            width: 40, height: 40, background: '#fbfbf9', border: '0.5px solid #c2c0b9',
            borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center',
            transform: isOn ? 'scale(0.92)' : 'scale(1)', transition: 'transform 0.15s',
          }}>
            <div style={{
              width: 16, height: 5, borderRadius: 2,
              background: isOn ? '#5fb8e8' : '#6b6b6b', transition: 'background 0.3s',
            }} />
          </div>
        </div>

        {/* ─── Табличка и форма — появляются, когда лампа включена ─── */}
        <div style={{
          position: 'absolute', left: '50%', top: 150, transform: 'translateX(-50%)', width: 210,
          opacity: isOn ? 1 : 0, pointerEvents: isOn ? 'auto' : 'none', transition: 'opacity 0.6s',
        }}>
          {(mode === 'login' || mode === 'register') && <>
            <p style={{ textAlign: 'center', color: '#d9c9a0', fontSize: 12, letterSpacing: 3, margin: '0 0 14px' }}>
              {mode === 'login' ? 'ВХОД' : 'РЕГИСТРАЦИЯ'}
            </p>
            {error && <p style={s.error}>{error}</p>}
            {info && <p style={s.info}>{info}</p>}
            <input style={s.input} type="email" placeholder="Email" value={email}
              onChange={e => setEmail(e.target.value)} />
            <input style={s.input} type="password" placeholder="Пароль" value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleEmailAuth()} />
            <button style={s.btn} onClick={handleEmailAuth} disabled={loading}>
              {loading ? '...' : mode === 'login' ? 'Войти' : 'Зарегистрироваться'}
            </button>
            <button style={s.ghost} onClick={() => { setMode('phone'); setError(null); setInfo(null) }}>
              📱 Войти по SMS
            </button>
            <button style={s.ghost}
              onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); setInfo(null) }}>
              {mode === 'login' ? 'Нет аккаунта? Зарегистрироваться' : 'Уже есть аккаунт? Войти'}
            </button>
          </>}

          {mode === 'phone' && <>
            <p style={{ textAlign: 'center', color: '#d9c9a0', fontSize: 12, letterSpacing: 3, margin: '0 0 14px' }}>ВХОД ПО SMS</p>
            {error && <p style={s.error}>{error}</p>}
            {info && <p style={s.info}>{info}</p>}
            <input style={s.input} type="tel" placeholder="+7 900 000 00 00" value={phone}
              onChange={e => setPhone(e.target.value)} />
            <button style={s.btn} onClick={handlePhoneSend} disabled={loading}>
              {loading ? '...' : 'Получить код'}
            </button>
            <button style={s.ghost} onClick={() => { setMode('login'); setError(null) }}>← Назад</button>
          </>}

          {mode === 'phone_otp' && <>
            <p style={{ textAlign: 'center', color: '#d9c9a0', fontSize: 12, letterSpacing: 3, margin: '0 0 14px' }}>КОД ИЗ SMS</p>
            {error && <p style={s.error}>{error}</p>}
            {info && <p style={s.info}>{info}</p>}
            <input style={s.input} type="text" placeholder="000000" value={otp}
              onChange={e => setOtp(e.target.value)} maxLength={6}
              onKeyDown={e => e.key === 'Enter' && handlePhoneVerify()} />
            <button style={s.btn} onClick={handlePhoneVerify} disabled={loading}>
              {loading ? '...' : 'Войти'}
            </button>
            <button style={s.ghost} onClick={() => { setMode('phone'); setError(null) }}>← Отправить снова</button>
          </>}
        </div>

        {!isOn && (
          <p style={{
            position: 'absolute', left: '50%', top: 150, transform: 'translateX(-50%)',
            color: '#555', fontSize: 12, width: 200, textAlign: 'center',
          }}>
            Нажмите на выключатель слева
          </p>
        )}
      </div>

      <style>{`
        @keyframes wc-auth-sway {
          0%, 100% { transform: translateX(-50%) rotate(-4deg); }
          50% { transform: translateX(-50%) rotate(4deg); }
        }
      `}</style>
    </div>
  )
}
