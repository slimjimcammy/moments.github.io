import { useSession } from './hooks/useSession';
import { configError } from './lib/supabase';
import { MomentsPage } from './components/MomentsPage';
import { SignIn } from './components/SignIn';

export default function App() {
  const { session, ready } = useSession();

  if (configError) {
    return (
      <div className="hero">
        <div className="hero-card">
          <h1>Almost there</h1>
          <p>{configError}</p>
          <p className="muted">
            Copy <code>.env.example</code> to <code>packages/web/.env.local</code>, fill in your
            Supabase project URL and anon key, then restart <code>npm run dev</code>.
          </p>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="hero">
        <div className="hero-card hero-quiet">
          <p>Checking your session…</p>
        </div>
      </div>
    );
  }

  return session ? <MomentsPage session={session} /> : <SignIn />;
}
