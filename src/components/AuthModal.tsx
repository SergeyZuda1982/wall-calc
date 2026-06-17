import { useState } from 'react'
import { supabase } from '../lib/supabase'

type Mode = 'login' | 'register' | 'phone' | 'phone_otp'

export function AuthModal() {
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
    setLoading(false)
  }

  const s: Record<string, React.CSSProperties> = {
    overlay: {
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    },
    box: {
      background: '#fff', borderRadius: 12, padding: 32, width: 360,
      boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
    },
    title: { margin: '0 0 20px', fontSize: 20, fontWeight: 700, color: '#222' },
    input: {
      width: '100%', padding: '9px 12px', border: '1px solid #ccc',
      borderRadius: 7, fontSize: 14, boxSizing: 'border-box', marginBottom: 10,
    },
    btn: {
      width: '100%', padding: '10px', background: '#3a7bd5', color: '#fff',
      border: 'none', borderRadius: 7, fontSize: 14, fontWeight: 600,
      cursor: 'pointer', marginBottom: 8,
    },
    btnGhost: {
      width: '100%', padding: '10px', background: 'transparent', color: '#3a7bd5',
      border: '1px solid #3a7bd5', borderRadius: 7, fontSize: 14,
      cursor: 'pointer', marginBottom: 8,
    },
    divider: { textAlign: 'center', color: '#aaa', fontSize: 12, margin: '8px 0' },
    error: { color: '#c0392b', fontSize: 13, marginBottom: 8 },
    info: { color: '#27ae60', fontSize: 13, marginBottom: 8 },
  }

  return (
    <div style={s.overlay}>
      <div style={s.box}>
        {(mode === 'login' || mode === 'register') && <>
          <p style={s.title}>{mode === 'login' ? 'Вход' : 'Регистрация'}</p>
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
          <div style={s.divider}>или</div>
          <button style={s.btnGhost} onClick={() => { setMode('phone'); setError(null); setInfo(null) }}>
            📱 Войти по SMS
          </button>
          <button style={{ ...s.btnGhost, border: 'none', color: '#888', fontSize: 13 }}
            onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); setInfo(null) }}>
            {mode === 'login' ? 'Нет аккаунта? Зарегистрироваться' : 'Уже есть аккаунт? Войти'}
          </button>
        </>}

        {mode === 'phone' && <>
          <p style={s.title}>Вход по SMS</p>
          {error && <p style={s.error}>{error}</p>}
          {info && <p style={s.info}>{info}</p>}
          <input style={s.input} type="tel" placeholder="+7 900 000 00 00" value={phone}
            onChange={e => setPhone(e.target.value)} />
          <button style={s.btn} onClick={handlePhoneSend} disabled={loading}>
            {loading ? '...' : 'Получить код'}
          </button>
          <button style={{ ...s.btnGhost, border: 'none', color: '#888', fontSize: 13 }}
            onClick={() => { setMode('login'); setError(null) }}>
            ← Назад
          </button>
        </>}

        {mode === 'phone_otp' && <>
          <p style={s.title}>Введите код из SMS</p>
          {error && <p style={s.error}>{error}</p>}
          {info && <p style={s.info}>{info}</p>}
          <input style={s.input} type="text" placeholder="000000" value={otp}
            onChange={e => setOtp(e.target.value)} maxLength={6}
            onKeyDown={e => e.key === 'Enter' && handlePhoneVerify()} />
          <button style={s.btn} onClick={handlePhoneVerify} disabled={loading}>
            {loading ? '...' : 'Войти'}
          </button>
          <button style={{ ...s.btnGhost, border: 'none', color: '#888', fontSize: 13 }}
            onClick={() => { setMode('phone'); setError(null) }}>
            ← Отправить снова
          </button>
        </>}
      </div>
    </div>
  )
}
