import { useState, type FormEvent } from "react";
import { completePasswordRecovery } from "../data/authService";

type PasswordRecoveryScreenProps = {
  email: string;
  onComplete: () => void;
};

export default function PasswordRecoveryScreen({ email, onComplete }: PasswordRecoveryScreenProps) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);

    try {
      await completePasswordRecovery(password);
      setCompleted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update password.");
    } finally {
      setSubmitting(false);
    }
  }

  if (completed) {
    return (
      <main className="app-shell login-shell">
        <section className="login-card recovery-card">
          <p className="eyebrow">Password updated</p>
          <h1>Your new password is ready.</h1>
          <p>
            Sign in with <strong>{email}</strong> and your new password. Field staff should use the CleanOps mobile
            app; operators can sign in on this dashboard.
          </p>
          <button className="primary-button" onClick={onComplete} type="button">
            Continue to sign in
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell login-shell">
      <section className="login-card recovery-card">
        <p className="eyebrow">Reset password</p>
        <h1>Set a new password.</h1>
        <p>
          You opened a secure reset link for <strong>{email}</strong>. Choose a new password to finish account
          recovery.
        </p>

        <form className="recovery-form" onSubmit={(event) => void handleSubmit(event)}>
          {error ? <p className="inline-error">{error}</p> : null}

          <label>
            New password
            <div className="password-field">
              <input
                autoComplete="new-password"
                minLength={8}
                onChange={(event) => setPassword(event.target.value)}
                required
                type={showPassword ? "text" : "password"}
                value={password}
              />
              <button
                className="ghost-button password-toggle"
                onClick={() => setShowPassword((current) => !current)}
                type="button"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </label>

          <label>
            Confirm password
            <input
              autoComplete="new-password"
              minLength={8}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              type={showPassword ? "text" : "password"}
              value={confirmPassword}
            />
          </label>

          <button className="primary-button" disabled={submitting} type="submit">
            {submitting ? "Updating..." : "Update password"}
          </button>
        </form>
      </section>
    </main>
  );
}
