import { useState } from 'react'
import { useAuth } from './AuthContext.tsx'
import { ChartIcon, SettingsIcon } from './icons.tsx'
import { Modal } from './Modal.tsx'

type ProfileOverlayProps = {
  open: boolean
  onClose: () => void
  onOpenDashboard: () => void
  onOpenSettings: () => void
}

export function ProfileOverlay({
  open,
  onClose,
  onOpenDashboard,
  onOpenSettings,
}: ProfileOverlayProps) {
  const { user, signOut } = useAuth()
  const [signingOut, setSigningOut] = useState(false)

  if (!user) {
    return null
  }

  const initials = (user.name || user.email).trim().slice(0, 1).toUpperCase()

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await signOut()
      onClose()
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <Modal open={open} title="Your account" onClose={onClose} size="small">
      <div className="profile-identity">
        <span className="avatar avatar-large" aria-hidden="true">
          {initials}
        </span>
        <div className="profile-text">
          {user.name ? <p className="profile-name">{user.name}</p> : null}
          <p className="profile-email">{user.email}</p>
        </div>
      </div>
      <div className="profile-actions">
        <button className="button button-ghost" type="button" onClick={onOpenDashboard}>
          <ChartIcon size={14} />
          Your links
        </button>
        <button className="button button-ghost" type="button" onClick={onOpenSettings}>
          <SettingsIcon size={14} />
          Settings
        </button>
        <button
          className="button button-ghost button-danger"
          type="button"
          disabled={signingOut}
          onClick={() => {
            void handleSignOut()
          }}
        >
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </Modal>
  )
}
