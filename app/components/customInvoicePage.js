"use client";

import { useEffect, useMemo, useState } from "react";
import { t } from "../i18n";
import { formatUserDate, formatUserNumber } from "../lib/dateTimePreferences";
import LoadingSpinner from "./loadingSpinner";

function formatMoney(amount, currency, locale) {
  try {
    return formatUserNumber((Number(amount) || 0) / 100, {
      formatOptions: {
        currency: String(currency || "USD").toUpperCase(),
        style: "currency",
      },
      locale,
    });
  } catch {
    return `${((Number(amount) || 0) / 100).toFixed(2)} ${String(currency || "USD").toUpperCase()}`;
  }
}

function formatDate(timestamp, locale) {
  const preferredDate = timestamp
    ? formatUserDate(new Date(timestamp * 1000), { locale })
    : "";
  if (preferredDate) return preferredDate;
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
    new Date(timestamp * 1000),
  );
}

function addressLines(address) {
  if (!address) return [];
  return [
    address.line1,
    address.line2,
    [address.city, address.state, address.postal_code]
      .filter(Boolean)
      .join(", "),
    address.country,
  ].filter(Boolean);
}

export default function CustomInvoicePage({ invoiceId }) {
  const [copy, setCopy] = useState(() => t("en"));
  const [invoice, setInvoice] = useState(null);
  const [state, setState] = useState("loading");
  const locale =
    typeof document === "undefined"
      ? "en"
      : document.documentElement.lang || navigator.language || "en";

  useEffect(() => {
    const refreshCopy = () => setCopy(t());
    refreshCopy();
    window.addEventListener("munetios:languagechange", refreshCopy);
    window.addEventListener("munetios:localechange", refreshCopy);
    return () => {
      window.removeEventListener("munetios:languagechange", refreshCopy);
      window.removeEventListener("munetios:localechange", refreshCopy);
    };
  }, []);

  useEffect(() => {
    if (!/^in_[A-Za-z0-9]{8,200}$/.test(invoiceId || "")) {
      setState("not-found");
      return;
    }
    fetch("/api/billing", { cache: "no-store", credentials: "include" })
      .then(async (response) => {
        if (response.status === 401) {
          window.location.assign(
            `/signin?returnTo=${encodeURIComponent(window.location.pathname)}`,
          );
          return null;
        }
        if (!response.ok) throw new Error("invoice_load_failed");
        return response.json();
      })
      .then((payload) => {
        if (!payload) return;
        const match = (payload.invoices || []).find(
          (candidate) => candidate.id === invoiceId,
        );
        setInvoice(match || null);
        setState(match ? "ready" : "not-found");
      })
      .catch(() => setState("error"));
  }, [invoiceId]);

  useEffect(() => {
    if (state !== "ready") return;
    const shouldPrint = new URLSearchParams(window.location.search).has(
      "print",
    );
    if (shouldPrint) window.setTimeout(() => window.print(), 250);
  }, [state]);

  const status = useMemo(() => {
    const statusKey = {
      draft: "billingStatusDraft",
      open: "billingStatusOpen",
      paid: "billingStatusPaid",
      uncollectible: "billingStatusUncollectible",
      void: "billingStatusVoid",
    }[invoice?.status];
    return copy[statusKey] || invoice?.status || "—";
  }, [copy, invoice?.status]);

  if (state !== "ready") {
    return (
      <main className="munetios-custom-invoice min-h-dvh bg-transparent px-5 py-16 text-[var(--foreground)]">
        <div className="liquid-glass mx-auto max-w-3xl rounded-[var(--theme-container-radius,1.5rem)] border border-white/10 p-8">
          {state === "loading"
            ? <LoadingSpinner label={copy.accountProcessing} />
            : <strong>{copy.billingInvoiceUnavailable}</strong>}
          <div className="mt-5">
            <a
              className="font-semibold text-[var(--accent)]"
              href="/account/settings/billing"
            >
              {copy.billingBackToBilling}
            </a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="munetios-custom-invoice min-h-dvh bg-transparent px-4 py-8 text-[var(--foreground)] print:p-0">
      <article className="liquid-glass munetios-custom-invoice-sheet mx-auto max-w-4xl rounded-[var(--theme-container-radius,1.5rem)] border border-white/10 p-6 print:max-w-none print:rounded-none print:p-8 sm:p-10">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-[color-mix(in_srgb,var(--foreground)_14%,transparent)] pb-8">
          <div>
            <a
              className="text-2xl font-black tracking-tight text-[var(--accent)] no-underline"
              href="/"
            >
              Munetios
            </a>
            <p className="mt-2 text-sm opacity-60">
              {copy.billingCustomInvoice}
            </p>
          </div>
          <div className="text-right">
            <h1 className="text-3xl font-black">{copy.billingInvoice}</h1>
            <p className="mt-1 font-semibold">{invoice.number || invoice.id}</p>
            <span className="mt-3 inline-flex rounded-full bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] px-3 py-1 text-xs font-bold uppercase text-[var(--accent)]">
              {status}
            </span>
          </div>
        </header>

        <section className="grid gap-8 border-b border-[color-mix(in_srgb,var(--foreground)_14%,transparent)] py-8 sm:grid-cols-2">
          <div>
            <h2 className="text-xs font-black uppercase tracking-widest text-[var(--accent)]">
              {copy.billingBillTo}
            </h2>
            <p className="mt-3 font-bold">
              {invoice.customerName || "Munetios customer"}
            </p>
            <p className="text-sm opacity-70">{invoice.customerEmail}</p>
            {addressLines(invoice.customerAddress).map((line) => (
              <p className="text-sm opacity-70" key={line}>
                {line}
              </p>
            ))}
          </div>
          <dl className="grid grid-cols-[auto_1fr] content-start gap-x-5 gap-y-2 text-sm sm:justify-self-end">
            <dt className="font-bold opacity-60">{copy.billingIssued}</dt>
            <dd>{formatDate(invoice.created, locale)}</dd>
            <dt className="font-bold opacity-60">{copy.billingDue}</dt>
            <dd>{formatDate(invoice.dueDate, locale)}</dd>
            <dt className="font-bold opacity-60">{copy.billingCurrency}</dt>
            <dd>{String(invoice.currency || "USD").toUpperCase()}</dd>
          </dl>
        </section>

        <section className="overflow-x-auto py-8">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b-2 border-[color-mix(in_srgb,var(--foreground)_14%,transparent)] text-xs uppercase tracking-wider opacity-70">
                <th className="pb-3">{copy.billingDescription}</th>
                <th className="pb-3 text-center">{copy.billingQuantity}</th>
                <th className="pb-3 text-right">{copy.billingAmount}</th>
              </tr>
            </thead>
            <tbody>
              {(invoice.lines || []).map((line) => (
                <tr
                  className="border-b border-[color-mix(in_srgb,var(--foreground)_9%,transparent)]"
                  key={line.id}
                >
                  <td className="py-4">
                    <strong>{line.description}</strong>
                    {line.periodStart
                      ? <small className="mt-1 block opacity-60">
                          {formatDate(line.periodStart, locale)} –{" "}
                          {formatDate(line.periodEnd, locale)}
                        </small>
                      : null}
                  </td>
                  <td className="py-4 text-center">{line.quantity}</td>
                  <td className="py-4 text-right font-semibold">
                    {formatMoney(line.amount, line.currency, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="ml-auto grid max-w-sm grid-cols-[1fr_auto] gap-x-8 gap-y-3 border-t border-[color-mix(in_srgb,var(--foreground)_14%,transparent)] pt-6 text-sm">
          <span>{copy.billingSubtotal}</span>
          <strong>
            {formatMoney(invoice.subtotal, invoice.currency, locale)}
          </strong>
          <span>{copy.billingTax}</span>
          <strong>{formatMoney(invoice.tax, invoice.currency, locale)}</strong>
          <span className="text-lg font-black">{copy.billingTotal}</span>
          <strong className="text-lg text-[var(--accent)]">
            {formatMoney(invoice.total, invoice.currency, locale)}
          </strong>
          <span>{copy.billingAmountPaid}</span>
          <strong>
            {formatMoney(invoice.amountPaid, invoice.currency, locale)}
          </strong>
          <span>{copy.billingAmountDue}</span>
          <strong>
            {formatMoney(invoice.amountDue, invoice.currency, locale)}
          </strong>
        </section>

        <footer className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-[color-mix(in_srgb,var(--foreground)_14%,transparent)] pt-6 print:hidden">
          <a
            className="font-bold text-[var(--accent)]"
            href="/account/settings/billing"
          >
            {copy.billingBackToBilling}
          </a>
          <button
            className="liquid-glass rounded-full border border-white/10 bg-[var(--accent)]! px-5 py-2.5 font-bold text-white"
            onClick={() => window.print()}
            type="button"
          >
            {copy.billingPrintInvoice}
          </button>
        </footer>
      </article>
    </main>
  );
}
