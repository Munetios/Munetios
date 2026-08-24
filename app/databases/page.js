import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { auth } from "../../auth.js";
import { hasDatabaseStaffAccess } from "../lib/databaseStaffAccess.js";
import {
  hasDurableAuthStore,
  listDurableAccounts,
  listDurableFeedback,
} from "../lib/durableAuthStore.js";

export const dynamic = "force-dynamic";
export const metadata = { title: "Scratch Database | Munetios" };

function value(value) {
  return value ? String(value) : "—";
}

export default async function DatabasesPage() {
  const session = await auth({ cookies: await cookies() });
  if (!hasDatabaseStaffAccess(session)) notFound();
  const available = hasDurableAuthStore();
  const [accounts, feedback] = available
    ? await Promise.all([
        listDurableAccounts({ limit: 500 }),
        listDurableFeedback({ limit: 500 }),
      ])
    : [[], []];

  return (
    <main className="min-h-dvh bg-[#100719] p-3 text-white sm:p-6">
      <header className="liquid-glass mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 rounded-3xl border border-purple-200/15 bg-purple-950/45 p-5 backdrop-blur-[3px]">
        <div>
          <p className="text-sm font-semibold text-purple-200">
            Munetios staff
          </p>
          <h1 className="mt-1 text-3xl font-bold">Scratch Database</h1>
        </div>
        <a
          className="rounded-xl bg-white/10 px-4 py-2 hover:bg-white/15"
          href="/apps"
        >
          Back to apps
        </a>
      </header>
      <div className="mx-auto mt-5 grid max-w-7xl gap-5">
        {!available
          ? <section className="liquid-glass rounded-3xl border border-red-300/20 bg-red-950/35 p-6 backdrop-blur-[3px]">
              Scratch Database is not connected. Add MUNETIOS_DATABASE_TOKEN or
              BLOB_READ_WRITE_TOKEN.
            </section>
          : null}
        <section className="liquid-glass overflow-hidden rounded-3xl border border-purple-200/15 bg-purple-950/35 backdrop-blur-[3px]">
          <div className="border-b border-white/10 p-5">
            <h2 className="text-xl font-bold">Accounts</h2>
            <p className="text-sm text-white/60">
              {accounts.length} account records
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/5 text-purple-200">
                <tr>
                  <th className="p-4">Name</th>
                  <th className="p-4">Email</th>
                  <th className="p-4">Username</th>
                  <th className="p-4">Plan</th>
                  <th className="p-4">Created</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr className="border-t border-white/8" key={account.id}>
                    <td className="p-4">{value(account.name)}</td>
                    <td className="p-4">{value(account.email)}</td>
                    <td className="p-4">{value(account.username)}</td>
                    <td className="p-4">{value(account.plan)}</td>
                    <td className="p-4">{value(account.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="liquid-glass overflow-hidden rounded-3xl border border-purple-200/15 bg-purple-950/35 backdrop-blur-[3px]">
          <div className="border-b border-white/10 p-5">
            <h2 className="text-xl font-bold">Feedback</h2>
            <p className="text-sm text-white/60">{feedback.length} reports</p>
          </div>
          <div className="grid gap-3 p-4 sm:p-5">
            {feedback.map((report) => (
              <article
                className="rounded-2xl border border-white/10 bg-white/5 p-4"
                key={report.id}
              >
                <div className="flex flex-wrap justify-between gap-2">
                  <strong>{value(report.feedbackType)}</strong>
                  <span className="text-xs text-white/50">
                    {value(report.createdAt)}
                  </span>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm text-white/80">
                  {value(report.explanation)}
                </p>
                <p className="mt-3 text-xs text-purple-200">
                  {value(report.email)}
                </p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
