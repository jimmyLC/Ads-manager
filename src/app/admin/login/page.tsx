export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main style={{ maxWidth: 360 }}>
      <h1>Ads-manager</h1>
      <form method="post" action="/api/admin/login" className="grid" style={{ gridTemplateColumns: "1fr" }}>
        <label>帳號<input name="username" autoComplete="username" required autoFocus /></label>
        <label>密碼<input name="password" type="password" autoComplete="current-password" required /></label>
        {error && <p className="err">帳號或密碼錯誤，或嘗試次數過多請稍後再試。</p>}
        <button className="primary">登入</button>
      </form>
    </main>
  );
}
