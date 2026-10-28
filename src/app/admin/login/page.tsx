import { redirect } from "next/navigation";
import { getAdminSession, getStaffCount } from "@/lib/admin-auth";
import { signIn } from "@/app/admin/actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getAdminSession()) redirect("/admin");
  const [{ error }, staffCount] = await Promise.all([
    searchParams,
    Promise.resolve(getStaffCount()),
  ]);
  return (
    <main className="admin-login-page">
      <a className="admin-brand" href="/">
        <span className="brand-mark">BB</span>
        <span>BB Cloud Kitchen <small>STAFF CONSOLE</small></span>
      </a>
      <section className="admin-login-card">
        <p className="admin-eyebrow">AUTHORIZED STAFF ONLY</p>
        <h1>Welcome <em>back.</em></h1>
        <p className="admin-muted">
          Sign in with your administrator account to manage kitchen operations.
        </p>
        {error && (
          <p className="admin-alert" role="alert">
            Sign-in failed. Check your details or try again later.
          </p>
        )}
        {staffCount === 0 ? (
          <p className="admin-alert">
            Admin access is not set up yet. An owner must run the one-time
            server-side setup command described in the project README.
          </p>
        ) : (
          <form action={signIn} className="admin-form">
            <label>
              <span>Email address</span>
              <input
                name="email"
                type="email"
                maxLength={254}
                autoComplete="username"
                required
              />
            </label>
            <label>
              <span>Password</span>
              <input
                name="password"
                type="password"
                maxLength={128}
                autoComplete="current-password"
                required
              />
            </label>
            <button className="admin-button admin-button-primary" type="submit">
              Sign in securely
            </button>
          </form>
        )}
        <a className="admin-back-link" href="/">Back to BB Cloud Kitchen</a>
      </section>
    </main>
  );
}
