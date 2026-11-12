export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="login">
      <div className="card">
        <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: 16, padding: 24 }}>
          <div className="brand">
            <div className="avatar" style={{ borderRadius: 10, width: 36, height: 36 }}>A</div>
            <div><h1>Ads-manager</h1><div className="small muted">廣告管理員</div></div>
          </div>
          <form method="post" action="/api/admin/login" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <label className="field">帳號<input name="username" autoComplete="username" required autoFocus /></label>
            <label className="field">密碼<input name="password" type="password" autoComplete="current-password" required /></label>
            {error && <div className="notice err">帳號或密碼錯誤，或嘗試次數過多，請稍後再試。</div>}
            <button className="primary" style={{ justifyContent: "center", height: 40 }}>登入</button>
          </form>
        </div>
      </div>
    </main>
  );
}
