import { useCallback, useEffect, useMemo, useState } from "react";
import type { AccountDto, ApiKeyDto, JobDto } from "@facebook-army/shared";
import { api, getAdminToken, setAdminToken } from "./api";
import {
  IconCamera,
  IconClose,
  IconCursor,
  IconLogin,
  IconPlay,
  IconReady,
  IconStop,
  IconTrash,
  IconMonitor,
  IconPhone,
  IconWindow,
} from "./Icons";
import LivePhone, { type DeviceMode } from "./LivePhone";

type Toast = { kind: "ok" | "err"; text: string } | null;

function statusChip(status: AccountDto["status"]) {
  if (status === "ready") return "live";
  if (status === "checkpoint" || status === "offline") return "danger";
  if (status === "needs_login" || status === "busy" || status === "paused") return "warn";
  return "";
}

function screenshotSrc(account: AccountDto): string | null {
  if (!account.screenshotUrl) return null;
  return `${account.screenshotUrl}?t=${encodeURIComponent(account.updatedAt)}`;
}

export default function App() {
  const [tokenReady, setTokenReady] = useState(Boolean(getAdminToken()));
  const [bootstrapping, setBootstrapping] = useState(false);
  const [manualToken, setManualToken] = useState("");
  const [accounts, setAccounts] = useState<AccountDto[]>([]);
  const [jobs, setJobs] = useState<JobDto[]>([]);
  const [keys, setKeys] = useState<ApiKeyDto[]>([]);
  const [health, setHealth] = useState<{
    accounts: number;
    readyAccounts: number;
    queuedJobs: number;
    runningJobs: number;
    liveBrowsers?: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [liveKey, setLiveKey] = useState(0);
  const [deviceMode, setDeviceMode] = useState<DeviceMode>("mobile");

  const [form, setForm] = useState({
    label: "",
    clientName: "",
    facebookName: "",
    proxyUrl: "",
    timezone: "America/New_York",
    password: "",
  });

  const [keyForm, setKeyForm] = useState({
    name: "",
    clientName: "",
    accountIds: [] as string[],
  });

  const showToast = (kind: "ok" | "err", text: string) => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 4200);
  };

  const refresh = useCallback(async () => {
    try {
      const [a, j, h] = await Promise.all([
        api.accounts(),
        api.jobs(),
        api.health(),
      ]);
      setAccounts(a);
      setJobs(j);
      setHealth(h);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (!tokenReady) return;
    void refresh();
    const id = setInterval(() => void refresh(), 3000);
    return () => clearInterval(id);
  }, [tokenReady, refresh]);

  const selected = useMemo(
    () => accounts.find((a) => a.id === selectedId) || null,
    [accounts, selectedId]
  );

  const selectedJobs = useMemo(
    () => (selectedId ? jobs.filter((j) => j.accountId === selectedId).slice(0, 8) : []),
    [jobs, selectedId]
  );

  const openSession = (id: string) => {
    setSelectedId(id);
    setLiveKey((k) => k + 1);
    requestAnimationFrame(() => setPanelOpen(true));
  };

  const closeSession = () => {
    setPanelOpen(false);
    setTimeout(() => {
      setSelectedId(null);
    }, 280);
  };

  const restartLive = () => {
    setLiveKey((k) => k + 1);
  };

  const openLoginWindow = (id: string) =>
    run(
      id,
      () => api.openLogin(id),
      "Login window opening — sign in there, then Mark Ready"
    );

  const toggleDeviceMode = () => {
    const next: DeviceMode = deviceMode === "mobile" ? "desktop" : "mobile";
    setDeviceMode(next);
    setLiveKey((k) => k + 1);
    showToast("ok", next === "mobile" ? "Switched to mobile view" : "Switched to desktop view");
  };

  const bootstrap = async () => {
    setBootstrapping(true);
    try {
      const res = await api.bootstrap();
      setAdminToken(res.adminToken);
      setTokenReady(true);
      showToast("ok", "Admin token loaded from this machine");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBootstrapping(false);
    }
  };

  const unlockWithToken = () => {
    const token = manualToken.trim();
    if (token.length < 8) {
      setError("Paste the full ADMIN_TOKEN from your .env file");
      return;
    }
    setAdminToken(token);
    setTokenReady(true);
    showToast("ok", "Unlocked with ADMIN_TOKEN");
  };

  const createKeyOrExplain = () => {
    if (!keyForm.name || !keyForm.clientName || !keyForm.accountIds.length) {
      showToast(
        "err",
        !keyForm.name
          ? "Enter a key name first"
          : !keyForm.clientName
            ? "Enter a client name first"
            : accounts.length === 0
              ? "Add an account before creating an API key"
              : "Check at least one account to allow"
      );
      return;
    }
    void createKey();
  };

  const createAccount = async () => {
    try {
      setBusyId("create");
      const account = await api.createAccount({
        label: form.label,
        clientName: form.clientName,
        facebookName: form.facebookName || undefined,
        proxyUrl: form.proxyUrl || undefined,
        timezone: form.timezone,
        password: form.password || undefined,
      });
      setShowCreate(false);
      setForm({
        label: "",
        clientName: "",
        facebookName: "",
        proxyUrl: "",
        timezone: "America/New_York",
        password: "",
      });
      await refresh();
      showToast("ok", `Created ${account.label}`);
      openSession(account.id);
    } catch (err) {
      showToast("err", err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const run = async (id: string, fn: () => Promise<unknown>, ok: string) => {
    try {
      setBusyId(id);
      await fn();
      showToast("ok", ok);
      await refresh();
    } catch (err) {
      showToast("err", err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const loadKeys = async () => {
    try {
      setKeys(await api.keys());
      setShowKeys(true);
    } catch (err) {
      showToast("err", err instanceof Error ? err.message : String(err));
    }
  };

  const createKey = async () => {
    try {
      const res = await api.createKey(keyForm);
      setRawKey(res.rawKey);
      setKeys(await api.keys());
      setKeyForm({ name: "", clientName: "", accountIds: [] });
      showToast("ok", "API key created — copy it now");
    } catch (err) {
      showToast("err", err instanceof Error ? err.message : String(err));
    }
  };

  const readyCount = useMemo(
    () => accounts.filter((a) => a.status === "ready").length,
    [accounts]
  );

  if (!tokenReady) {
    return (
      <div className="setup">
        <div className="setup-card">
          <div className="brand-mark" style={{ marginBottom: 14 }}>
            <span className="brand-orb" />
            <strong>Facebook Army</strong>
          </div>
          <h1>Station setup</h1>
          <p style={{ color: "var(--muted)", marginTop: 0 }}>
            One-time connect for this browser. Run <code>npm run setup</code> first,
            then start the station and unlock the dashboard.
          </p>
          <div className="setup-steps">
            <div className="step">
              <div className="step-num">1</div>
              <div>
                <strong>Install & configure</strong>
                <span>In the project folder: npm run setup</span>
              </div>
            </div>
            <div className="step">
              <div className="step-num">2</div>
              <div>
                <strong>Start the station</strong>
                <span>npm run dev  (or npm start after build)</span>
              </div>
            </div>
            <div className="step">
              <div className="step-num">3</div>
              <div>
                <strong>Add sticky ISP proxies</strong>
                <span>One dedicated IP per Facebook account (optional for your test account)</span>
              </div>
            </div>
            <div className="step">
              <div className="step-num">4</div>
              <div>
                <strong>Manual login → Mark Ready</strong>
                <span>Then issue API keys for each client AI</span>
              </div>
            </div>
          </div>
          {error && <div className="error-banner">{String(error)}</div>}
          <button className="btn primary" onClick={() => void bootstrap()} disabled={bootstrapping}>
            {bootstrapping ? "Connecting…" : "Unlock dashboard"}
          </button>
          <div className="field" style={{ marginTop: 18 }}>
            <label>Or paste ADMIN_TOKEN (for Tailscale)</label>
            <input
              value={manualToken}
              onChange={(e) => setManualToken(e.target.value)}
              placeholder="From .env on the station machine"
              autoComplete="off"
            />
          </div>
          <button
            className="btn"
            style={{ marginTop: 10 }}
            onClick={unlockWithToken}
            disabled={!manualToken.trim()}
          >
            Unlock with token
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <span className="brand-orb" />
            <h1>Facebook Army</h1>
          </div>
          <p>Account station — mobile sessions, sticky ISP isolation, AI action API</p>
        </div>
        <div className="top-actions">
          <button className="btn" onClick={() => void refresh()}>
            Refresh
          </button>
          <button className="btn" onClick={() => void loadKeys()}>
            API keys
          </button>
          <button className="btn primary" onClick={() => setShowCreate(true)}>
            Add account
          </button>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <section className="stats">
        <div className="stat">
          <div className="label">Accounts</div>
          <div className="value">{health?.accounts ?? accounts.length}</div>
        </div>
        <div className="stat">
          <div className="label">Ready</div>
          <div className="value">{health?.readyAccounts ?? readyCount}</div>
        </div>
        <div className="stat">
          <div className="label">Live browsers</div>
          <div className="value">{health?.liveBrowsers ?? 0}</div>
        </div>
        <div className="stat">
          <div className="label">Queue</div>
          <div className="value">
            {(health?.runningJobs ?? 0) + (health?.queuedJobs ?? 0)}
          </div>
        </div>
      </section>

      <section className="fleet">
        {accounts.length === 0 && (
          <div className="empty-fleet">
            <h3>No accounts yet</h3>
            <p>
              Add your account (proxy optional for testing on this PC’s IP), open the
              session, sign into Facebook, then mark it ready.
            </p>
            <button className="btn primary" onClick={() => setShowCreate(true)}>
              Add first account
            </button>
          </div>
        )}

        {accounts.map((account) => {
          const src = screenshotSrc(account);
          return (
            <article
              key={account.id}
              className={`phone-tile ${selectedId === account.id ? "active" : ""}`}
              onClick={() => openSession(account.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") openSession(account.id);
              }}
            >
              <div className="phone-bezel">
                <div className="phone-notch" />
                <div className="phone-screen">
                  {src ? (
                    <img src={src} alt={`${account.label} preview`} />
                  ) : (
                    <div className="screen-empty">
                      Tap to open
                      <br />
                      & take control
                    </div>
                  )}
                  <div className="screen-scan" />
                </div>
              </div>
              <div className="phone-meta">
                <div className="phone-meta-top">
                  <div>
                    <h3 className="tile-title">{account.label}</h3>
                    <p className="tile-sub">{account.clientName}</p>
                  </div>
                  <span className={`chip ${statusChip(account.status)}`}>
                    <span className="status-dot" />
                    {account.status}
                  </span>
                </div>
                <div className="icon-row" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="icon-btn"
                    title="Open login window"
                    disabled={busyId === account.id}
                    onClick={() => void openLoginWindow(account.id)}
                  >
                    <IconLogin />
                  </button>
                  <button
                    className="icon-btn"
                    title="Take control"
                    disabled={busyId === account.id}
                    onClick={() => openSession(account.id)}
                  >
                    <IconCursor />
                  </button>
                  <button
                    className="icon-btn"
                    title="Mark ready"
                    disabled={busyId === account.id}
                    onClick={() =>
                      void run(account.id, () => api.markReady(account.id), "Marked ready")
                    }
                  >
                    <IconReady />
                  </button>
                  <button
                    className="icon-btn"
                    title="Screenshot"
                    disabled={busyId === account.id}
                    onClick={() =>
                      void run(account.id, () => api.screenshot(account.id), "Screenshot queued")
                    }
                  >
                    <IconCamera />
                  </button>
                  <button
                    className="icon-btn danger"
                    title={account.status === "paused" ? "Resume traffic" : "Stop traffic"}
                    disabled={busyId === account.id}
                    onClick={() =>
                      void run(
                        account.id,
                        () =>
                          account.status === "paused"
                            ? api.resume(account.id)
                            : api.pause(account.id),
                        account.status === "paused" ? "Traffic resumed" : "Traffic stopped"
                      )
                    }
                  >
                    {account.status === "paused" ? <IconPlay /> : <IconStop />}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </section>

      <section className="panel">
        <h2>Recent jobs</h2>
        <p className="hint">Actions from the dashboard and client AI agents</p>
        <div className="jobs">
          {jobs.length === 0 && <div className="chip">No jobs yet</div>}
          {jobs.slice(0, 12).map((job) => (
            <div key={job.id} className="job-row">
              <code>{job.type}</code>
              <span>
                {job.accountId.slice(0, 8)}… · {job.status}
                {job.error ? ` — ${job.error}` : ""}
              </span>
              <span style={{ color: "var(--muted)", textAlign: "right" }}>
                {new Date(job.createdAt).toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Session control popup */}
      {selected && (
        <div
          className={`session-backdrop ${panelOpen ? "open" : ""}`}
          onClick={closeSession}
        >
          <div
            className={`session-panel ${panelOpen ? "open" : ""}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`session-phone ${deviceMode}`}>
              <LivePhone
                key={`${selected.id}-${liveKey}-${deviceMode}`}
                accountId={selected.id}
                active={panelOpen}
                deviceMode={deviceMode}
                large
              />
              <p className="live-hint">
                Click to control · type to enter text · scroll to move
              </p>
            </div>

            <aside className="session-side">
              <div className="session-side-head">
                <div>
                  <h2>{selected.label}</h2>
                  <p>
                    {selected.clientName}
                    {selected.facebookName ? ` · ${selected.facebookName}` : ""}
                  </p>
                </div>
                <button className="icon-btn" title="Close" onClick={closeSession}>
                  <IconClose />
                </button>
              </div>

              <div className="meta" style={{ marginBottom: 16 }}>
                <span className={`chip ${statusChip(selected.status)}`}>
                  <span className="status-dot" />
                  {selected.status}
                </span>
                <span className={`chip ${selected.proxyHost ? "" : "live"}`}>
                  {selected.proxyHost
                    ? `${selected.proxyHost}:${selected.proxyPort}`
                    : "this PC IP"}
                </span>
                <span className="chip">{deviceMode}</span>
              </div>

              {selected.lastError && (
                <div className="error-banner" style={{ marginBottom: 14 }}>
                  {selected.lastError}
                </div>
              )}

              <h3 className="side-label">Quick actions</h3>
              <div className="quick-actions">
                <button className="action-btn primary" onClick={toggleDeviceMode}>
                  {deviceMode === "mobile" ? <IconMonitor /> : <IconPhone />}
                  <span>
                    <strong>
                      {deviceMode === "mobile" ? "Desktop view" : "Mobile view"}
                    </strong>
                    <em>
                      {deviceMode === "mobile"
                        ? "Switch to wide browser layout"
                        : "Switch to phone layout"}
                    </em>
                  </span>
                </button>
                <button
                  className="action-btn"
                  onClick={() => {
                    restartLive();
                    showToast("ok", "Live control reconnected");
                  }}
                >
                  <IconCursor />
                  <span>
                    <strong>Reconnect live</strong>
                    <em>Reload the live stream</em>
                  </span>
                </button>
                <button
                  className="action-btn"
                  disabled={busyId === selected.id}
                  onClick={() => void openLoginWindow(selected.id)}
                >
                  <IconLogin />
                  <span>
                    <strong>Open login window</strong>
                    <em>Separate Chromium window for sign-in</em>
                  </span>
                </button>
                <button
                  className="action-btn"
                  disabled={busyId === selected.id}
                  onClick={() =>
                    void run(selected.id, () => api.markReady(selected.id), "Marked ready")
                  }
                >
                  <IconReady />
                  <span>
                    <strong>Mark ready</strong>
                    <em>Allow AI actions</em>
                  </span>
                </button>
                <button
                  className="action-btn"
                  disabled={busyId === selected.id}
                  onClick={() =>
                    void run(selected.id, () => api.screenshot(selected.id), "Screenshot saved")
                  }
                >
                  <IconCamera />
                  <span>
                    <strong>Save snapshot</strong>
                    <em>Update fleet thumbnail</em>
                  </span>
                </button>
                <button
                  className="action-btn"
                  disabled={busyId === selected.id}
                  onClick={() =>
                    void run(selected.id, () => api.closeBrowser(selected.id), "Browser closed").then(
                      () => restartLive()
                    )
                  }
                >
                  <IconWindow />
                  <span>
                    <strong>Restart browser</strong>
                    <em>Close then reconnect live</em>
                  </span>
                </button>
                <button
                  className={`action-btn ${selected.status === "paused" ? "" : "danger"}`}
                  disabled={busyId === selected.id}
                  onClick={() =>
                    void run(
                      selected.id,
                      () =>
                        selected.status === "paused"
                          ? api.resume(selected.id)
                          : api.pause(selected.id),
                      selected.status === "paused"
                        ? "Traffic resumed"
                        : "All traffic stopped for this session"
                    )
                  }
                >
                  {selected.status === "paused" ? <IconPlay /> : <IconStop />}
                  <span>
                    <strong>
                      {selected.status === "paused" ? "Resume traffic" : "Stop all traffic"}
                    </strong>
                    <em>
                      {selected.status === "paused"
                        ? "Allow jobs again"
                        : "Cancel queue, pause AI, close browser"}
                    </em>
                  </span>
                </button>
                <button
                  className="action-btn danger"
                  onClick={() => {
                    if (!confirm(`Remove account “${selected.label}”?`)) return;
                    void run(selected.id, () => api.deleteAccount(selected.id), "Account removed").then(
                      () => closeSession()
                    );
                  }}
                >
                  <IconTrash />
                  <span>
                    <strong>Remove account</strong>
                    <em>Profile files stay on disk</em>
                  </span>
                </button>
              </div>

              <h3 className="side-label" style={{ marginTop: 20 }}>
                Recent jobs
              </h3>
              <div className="jobs compact">
                {selectedJobs.length === 0 && <div className="chip">No jobs yet</div>}
                {selectedJobs.map((job) => (
                  <div key={job.id} className="job-row compact">
                    <code>{job.type}</code>
                    <span>{job.status}</span>
                  </div>
                ))}
              </div>
            </aside>
          </div>
        </div>
      )}

      {showCreate && (
        <div className="modal-backdrop" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Add Facebook account</h3>
            <p>
              Leave the proxy blank to use <strong>this computer’s IP</strong> (good
              for testing your own account). For client accounts, paste a sticky ISP
              as <code>user:pass@host:port</code>.
            </p>
            <div className="form-grid">
              <div className="field">
                <label>Label</label>
                <input
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                  placeholder="My personal FB"
                />
              </div>
              <div className="field">
                <label>Client name</label>
                <input
                  value={form.clientName}
                  onChange={(e) => setForm({ ...form, clientName: e.target.value })}
                  placeholder="Me / Test"
                />
              </div>
              <div className="field">
                <label>Facebook display name (optional)</label>
                <input
                  value={form.facebookName}
                  onChange={(e) => setForm({ ...form, facebookName: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Sticky ISP proxy (optional)</label>
                <input
                  value={form.proxyUrl}
                  onChange={(e) => setForm({ ...form, proxyUrl: e.target.value })}
                  placeholder="Leave blank = this PC’s IP"
                />
              </div>
              <div className="field">
                <label>Timezone</label>
                <input
                  value={form.timezone}
                  onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                  placeholder="America/Chicago"
                />
              </div>
              <div className="field">
                <label>Password backup (encrypted, optional)</label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="Saved only for re-login help"
                />
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={!form.label || !form.clientName || busyId === "create"}
                onClick={() => void createAccount()}
              >
                Create account
              </button>
            </div>
          </div>
        </div>
      )}

      {showKeys && (
        <div className="modal-backdrop" onClick={() => setShowKeys(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: "min(640px, 100%)" }}>
            <h3>Client AI API keys</h3>
            <p>
              Give each founder’s AI a scoped key. They call{" "}
              <code>/v1/accounts/:id/actions</code> with header <code>X-API-Key</code>.
            </p>
            {rawKey && (
              <div
                className="error-banner"
                style={{
                  background: "var(--mint-soft)",
                  borderColor: "rgba(111,211,163,.35)",
                  color: "var(--mint)",
                }}
              >
                Copy now — shown once:
                <br />
                <code style={{ color: "var(--text)" }}>{rawKey}</code>
              </div>
            )}
            <div className="form-grid">
              <div className="field">
                <label>Key name</label>
                <input
                  value={keyForm.name}
                  onChange={(e) => setKeyForm({ ...keyForm, name: e.target.value })}
                  placeholder="Client AI — Austin"
                />
              </div>
              <div className="field">
                <label>Client name</label>
                <input
                  value={keyForm.clientName}
                  onChange={(e) => setKeyForm({ ...keyForm, clientName: e.target.value })}
                  placeholder="Founder / company"
                />
              </div>
              <div className="field">
                <label>Allowed accounts</label>
                {accounts.length === 0 ? (
                  <p className="tile-sub" style={{ margin: 0 }}>
                    Add an account first, then come back to create a key.
                  </p>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn ghost"
                      style={{ marginBottom: 8 }}
                      onClick={() =>
                        setKeyForm((prev) => ({
                          ...prev,
                          accountIds: accounts.map((a) => a.id),
                        }))
                      }
                    >
                      Select all accounts
                    </button>
                    <div className="account-checkboxes">
                      {accounts.map((a) => {
                        const checked = keyForm.accountIds.includes(a.id);
                        return (
                          <label key={a.id} className={`check-row ${checked ? "on" : ""}`}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setKeyForm((prev) => ({
                                  ...prev,
                                  accountIds: checked
                                    ? prev.accountIds.filter((id) => id !== a.id)
                                    : [...prev.accountIds, a.id],
                                }));
                              }}
                            />
                            <span>
                              <strong>{a.label}</strong>
                              <em>{a.clientName}</em>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>
            {(!keyForm.name || !keyForm.clientName || !keyForm.accountIds.length) && (
              <p className="tile-sub" style={{ margin: "12px 0 0", color: "var(--amber)" }}>
                {!keyForm.name
                  ? "Enter a key name"
                  : !keyForm.clientName
                    ? "Enter a client name"
                    : "Check at least one account above (or Select all)"}
              </p>
            )}
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setShowKeys(false)}>
                Close
              </button>
              <button className="btn primary" onClick={createKeyOrExplain}>
                Create key
              </button>
            </div>
            <div className="jobs" style={{ marginTop: 16 }}>
              {keys.map((k) => (
                <div key={k.id} className="job-row" style={{ gridTemplateColumns: "1fr auto" }}>
                  <span>
                    <strong>{k.name}</strong> · {k.clientName} · {k.keyPreview} ·{" "}
                    {k.accountIds.length} accounts
                  </span>
                  <button
                    className="btn danger"
                    onClick={() =>
                      void api.deleteKey(k.id).then(async () => setKeys(await api.keys()))
                    }
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          className="toast"
          style={{ borderColor: toast.kind === "err" ? "rgba(240,113,120,.4)" : undefined }}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
