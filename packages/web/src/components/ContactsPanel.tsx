import { useRef, useState } from "react";
import { ApiError, type ApiUser } from "../api";
import { useContacts } from "../hooks/useContacts";
import { usePresence } from "../presence/PresenceContext";
import { Avatar } from "./Avatar";
import { SendIcon } from "../icons";

const ADD_ERRORS: Record<string, string> = {
  // Both people must have an account — there's no email-invite flow yet.
  user_not_found: "No account is registered with that email yet.",
  cannot_add_self: "That's your own account.",
};

function ContactRow({
  user,
  action,
  online,
}: {
  user: ApiUser;
  action?: React.ReactNode;
  online?: boolean;
}) {
  return (
    <li className="file-row hoverable">
      <Avatar id={user.id} name={user.displayName} online={online} />
      <span className="file-meta">
        {/* Email lives in the tooltip; accepted rows show presence instead.
            Pending rows have no presence, so they show nothing here. */}
        <span className="file-name" title={user.email ?? undefined}>
          {user.displayName}
        </span>
        {online !== undefined && (
          <span className={`file-sub ${online ? "online-tag" : ""}`}>{online ? "Online" : "Offline"}</span>
        )}
      </span>
      {action && <span className="row-actions">{action}</span>}
    </li>
  );
}

export function ContactsPanel() {
  const { data, loadError, add, remove } = useContacts();
  const { isContactOnline, sendToContact, callStatus } = usePresence();
  const [email, setEmail] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sendTargetRef = useRef<string | null>(null);

  const acceptedFiltered = (data?.accepted ?? []).filter((c) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      c.user.displayName.toLowerCase().includes(q) || (c.user.email ?? "").toLowerCase().includes(q)
    );
  });

  function pickFilesFor(userId: string) {
    sendTargetRef.current = userId;
    fileInputRef.current?.click();
  }

  function handleFilesChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    const target = sendTargetRef.current;
    if (target && files.length) sendToContact(target, files);
    e.target.value = "";
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await add({ email: email.trim() });
      setEmail("");
    } catch (err) {
      setError(err instanceof ApiError ? (ADD_ERRORS[err.code] ?? "Couldn't add contact.") : "Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="view">
      <div className="card">
        <input ref={fileInputRef} type="file" multiple hidden onChange={handleFilesChosen} />

        <form onSubmit={handleAdd} className="row">
          <input
            className="input"
            type="email"
            placeholder="Add a contact by email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <button className="btn btn-ghost" type="submit" disabled={busy}>
            Add
          </button>
        </form>
        {error && <p className="error">{error}</p>}
        {loadError && <p className="error">Couldn't load contacts.</p>}

        {data && data.incoming.length > 0 && (
          <section style={{ marginTop: 18 }}>
            <div className="section-label">Requests</div>
            <ul className="file-list">
              {data.incoming.map((c) => (
                <ContactRow
                  key={c.user.id}
                  user={c.user}
                  action={
                    <button className="btn btn-primary btn-sm" onClick={() => void add({ userId: c.user.id })}>
                      Accept
                    </button>
                  }
                />
              ))}
            </ul>
          </section>
        )}

        <section style={{ marginTop: 18 }}>
          <div className="section-label">Contacts</div>
          {data && data.accepted.length > 5 && (
            <input
              className="input"
              placeholder="Search contacts…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ marginBottom: 10 }}
            />
          )}
          {data && data.accepted.length > 0 ? (
            <ul className="file-list">
              {acceptedFiltered.map((c) => (
                <ContactRow
                  key={c.user.id}
                  user={c.user}
                  online={isContactOnline(c.user.id)}
                  action={
                    <>
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={!isContactOnline(c.user.id) || callStatus === "connecting"}
                        title={isContactOnline(c.user.id) ? "Send a file" : "Offline — can't send directly"}
                        onClick={() => pickFilesFor(c.user.id)}
                      >
                        <SendIcon size={14} /> Send
                      </button>
                      <button className="link-btn" onClick={() => void remove(c.user.id)}>
                        Remove
                      </button>
                    </>
                  }
                />
              ))}
            </ul>
          ) : (
            <p className="empty-hint">No contacts yet. Add someone by their email.</p>
          )}
        </section>

        {data && data.outgoing.length > 0 && (
          <section style={{ marginTop: 18 }}>
            <div className="section-label">Pending</div>
            <ul className="file-list">
              {data.outgoing.map((c) => (
                <ContactRow
                  key={c.user.id}
                  user={c.user}
                  action={
                    <span className="pending-tag">
                      sent
                      <button className="link-btn" onClick={() => void remove(c.user.id)}>
                        cancel
                      </button>
                    </span>
                  }
                />
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
