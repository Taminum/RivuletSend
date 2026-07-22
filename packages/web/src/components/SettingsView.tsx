import { useAuth } from "../auth/AuthContext";
import { AuthScreen } from "./AuthScreen";
import { AccountPanel } from "./AccountPanel";
import { AccentPicker } from "./AccentPicker";
import { AutoSaveSettings } from "./AutoSaveSettings";

export function SettingsView() {
  const { user, logout } = useAuth();

  return (
    <div className="view">
      <AccentPicker />
      <AutoSaveSettings />
      {user ? (
        <>
          <AccountPanel />
          <button className="btn btn-ghost" onClick={() => void logout()}>
            Sign out
          </button>
        </>
      ) : (
        <AuthScreen />
      )}
    </div>
  );
}
