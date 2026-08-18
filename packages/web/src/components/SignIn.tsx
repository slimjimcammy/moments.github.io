import { useState } from 'react';
import { signInWithGoogle } from '../lib/supabase';

export function SignIn() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  }

  return (
    <div className="hero">
      <div className="hero-card">
        <span className="hero-mark" aria-hidden>
          ▶
        </span>
        <h1>Moments</h1>
        <p>
          Every YouTube timestamp you saved, in one searchable place. Sign in with the same Google
          account you use in the extension.
        </p>
        <button className="solid" type="button" onClick={() => void start()} disabled={busy}>
          {busy ? 'Opening Google…' : 'Continue with Google'}
        </button>
        {error ? <p className="hero-error">{error}</p> : null}
      </div>
    </div>
  );
}
