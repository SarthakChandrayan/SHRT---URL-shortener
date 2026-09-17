import { useAuth } from './AuthContext.tsx'

type ProfileOverlayProps = {
  open: boolean
  onClose: () => void
}

export function ProfileOverlay({ open, onClose }: ProfileOverlayProps) {
  const { user } = useAuth()

  if (!open || !user) {
    return null
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="profile-title">
      <button
        className="overlay-backdrop"
        type="button"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="overlay-panel">
        <button className="overlay-close" type="button" onClick={onClose} aria-label="Close">
          ×
        </button>
        <h2 id="profile-title" className="auth-title">
          Your profile
        </h2>
        <div className="profile-identity">
          {user.name ? <p className="profile-name">{user.name}</p> : null}
          <p className="profile-email">{user.email}</p>
        </div>
      </div>
    </div>
  )
}
