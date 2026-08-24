"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getUserCurrency,
  loadDateTimePreferences,
} from "../lib/dateTimePreferences";
import { formatPlanPrice, getPlan } from "../lib/pricing";
import AccountAvatar from "./accountAvatar";
import AddFamilyMemberModal from "./addFamilyMemberModal";
import CheckoutModal from "./checkoutModal";
import { openCreateChildStorageKey } from "./childAccountSignIn";
import CreateChildAccountModal from "./createChildAccountModal";
import CustomToggle from "./customToggle";
import FamilyParentalControlsModal from "./familyParentalControlsModal";
import { showModal } from "./modal";
import { showToast } from "./toast";

const roleLabelKeys = {
  adult: "familyRoleAdult",
  child: "familyRoleChild",
  teen: "familyRoleTeen",
};
const subscriptionPlans = [
  getPlan("free"),
  getPlan("pro-lite"),
  getPlan("pro"),
];

function RemovalConfirmation({ close, copy, member, onRemoved }) {
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const isChild = member.role === "child";

  const confirmRemoval = async () => {
    if (isChild && step === 1) {
      setStep(2);
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(`/api/account/family/${member.id}`, {
        body: JSON.stringify({
          action: isChild ? "delete_child_account" : "remove_member",
        }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
      });
      if (!response.ok) throw new Error("family_member_removal_failed");
      onRemoved(member.id);
      close();
    } catch {
      showToast({ message: copy.familyErrorGeneric, type: "error" });
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="rounded-2xl border border-rose-300/20 bg-rose-500/10! p-4 text-sm leading-6 text-rose-50">
        {isChild
          ? step === 1
            ? copy.familyRemoveChildStepOne
            : copy.familyRemoveChildStepTwo
          : copy.familyRemoveTeenDescription}
      </p>
      <div className="flex justify-end gap-2">
        <button
          className="rounded-xl border border-white/15 bg-white/5! px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10! disabled:opacity-50"
          disabled={submitting}
          onClick={close}
          type="button"
        >
          {copy.cancel}
        </button>
        <button
          className="rounded-xl bg-rose-600/55! px-4 py-2 font-bold text-rose-50 disabled:opacity-50"
          disabled={submitting}
          onClick={confirmRemoval}
          type="button"
        >
          {submitting
            ? copy.accountProcessing
            : isChild && step === 1
              ? copy.continue
              : isChild
                ? copy.deleteAccount
                : copy.familyRemoveMember}
        </button>
      </div>
    </div>
  );
}

function MemberCard({ canManage, copy, member, onRemoved, onUpdated }) {
  const openControls = () => {
    const title = `${canManage ? copy.familyManageControls : copy.familyViewControls} - ${member.name}`;
    showModal(
      ({ close }) => (
        <FamilyParentalControlsModal
          close={close}
          copy={copy}
          member={member}
          onSaved={onUpdated}
          readOnly={!canManage}
        />
      ),
      { ariaLabel: title, maxWidth: "min(640px, 100%)", title },
    );
  };

  const remove = async () => {
    if (["child", "teen"].includes(member.role)) {
      const title =
        member.role === "child" ? copy.deleteAccount : copy.familyRemoveMember;
      showModal(
        ({ close }) => (
          <RemovalConfirmation
            close={close}
            copy={copy}
            member={member}
            onRemoved={onRemoved}
          />
        ),
        { ariaLabel: title, closeOnBackdrop: false, title },
      );
      return;
    }
    const response = await fetch(`/api/account/family/${member.id}`, {
      body: JSON.stringify({ action: "remove_member" }),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "DELETE",
    });
    if (response.ok) onRemoved(member.id);
    else showToast({ message: copy.familyErrorGeneric, type: "error" });
  };

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5! p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <AccountAvatar account={member} className="h-11 w-11 rounded-xl" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{member.name}</p>
          <p className="truncate text-xs text-white/55">{member.email}</p>
        </div>
        <span className="rounded-full border border-white/15 px-2.5 py-1 text-xs">
          {copy[roleLabelKeys[member.role]]}
        </span>
      </div>
      <div className="flex gap-2">
        {member.role !== "adult"
          ? <button
              className="rounded-xl border border-white/15 bg-white/5! px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/10!"
              onClick={openControls}
              type="button"
            >
              {canManage ? copy.familyManageControls : copy.familyViewControls}
            </button>
          : null}
        {canManage
          ? <button
              className="rounded-xl bg-rose-500/15! px-3 py-2 text-xs text-rose-100"
              onClick={remove}
              type="button"
            >
              {copy.familyRemoveMember}
            </button>
          : null}
      </div>
    </article>
  );
}

function FamilySubscriptions({ canManage, copy, onCheckout, preferences }) {
  const currency = getUserCurrency(preferences);
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">{copy.billingSubscriptions}</h2>
        <p className="mt-1 text-sm text-white/65">
          {copy.billingSubscriptionsDescription}
        </p>
        <p className="mt-2 rounded-xl border border-purple-200/20 bg-purple-500/10! p-3 text-xs text-purple-100">
          {copy.familySubscriptionPriceNotice}
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {subscriptionPlans.map((plan) => (
          <article
            className="flex min-h-56 flex-col rounded-2xl border border-white/10 bg-white/5! p-4"
            key={plan.id}
          >
            <icon className="text-2xl text-purple-200">
              {plan.id === "free"
                ? "person"
                : plan.id === "pro-lite"
                  ? "bolt"
                  : "workspace_premium"}
            </icon>
            <h3 className="mt-3 text-lg font-bold">{copy[plan.nameKey]}</h3>
            <p className="mt-1 text-2xl font-semibold">
              {formatPlanPrice(plan, currency, { preferences })}
            </p>
            <p className="mt-3 text-xs leading-5 text-white/60">
              {copy[plan.descriptionKey]}
            </p>
            <button
              className="mt-auto rounded-xl bg-purple-600/55! px-3 py-2 text-sm font-bold disabled:opacity-45"
              disabled={!canManage || plan.id === "free"}
              onClick={() => onCheckout(plan.id, currency)}
              type="button"
            >
              {plan.id === "free"
                ? copy.aiPricingStartFree
                : copy[plan.actionKey]}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function AccountFamiliesSection({ copy }) {
  const [state, setState] = useState({
    canManage: false,
    loaded: false,
    members: [],
  });
  const [shareSubscription, setShareSubscription] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [activeCategory, setActiveCategory] = useState("members");
  const [checkout, setCheckout] = useState(null);
  const [preferences, setPreferences] = useState(loadDateTimePreferences);

  const refresh = useCallback(() => {
    fetch("/api/account/family", { credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!payload) throw new Error("family_load_failed");
        setLoadError(false);
        setState({ ...payload, loaded: true });
      })
      .catch(() => {
        setLoadError(true);
        setState((current) => ({ ...current, loaded: true }));
      });
  }, []);

  const openCreateChild = useCallback(() => {
    showModal(
      ({ close }) => (
        <CreateChildAccountModal
          close={close}
          copy={copy}
          onCreated={refresh}
        />
      ),
      {
        ariaLabel: copy.familyCreateChildAction,
        title: copy.familyCreateChildAction,
      },
    );
  }, [copy, refresh]);

  useEffect(() => {
    refresh();
    fetch("/api/account/family/subscription-sharing", {
      credentials: "include",
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) =>
        setShareSubscription(Boolean(payload?.shareSubscription)),
      )
      .catch(() => {});
  }, [refresh]);

  useEffect(() => {
    const update = () => setPreferences(loadDateTimePreferences());
    window.addEventListener("munetios:language-time-change", update);
    return () =>
      window.removeEventListener("munetios:language-time-change", update);
  }, []);

  useEffect(() => {
    if (
      !state.loaded ||
      window.sessionStorage.getItem(openCreateChildStorageKey) !== "true"
    )
      return;
    window.sessionStorage.removeItem(openCreateChildStorageKey);
    if (state.canManage) openCreateChild();
    else showToast({ message: copy.familyErrorActorTooYoung, type: "error" });
  }, [copy, openCreateChild, state.canManage, state.loaded]);

  const openAddMember = () =>
    showModal(
      ({ close }) => (
        <AddFamilyMemberModal close={close} copy={copy} onAdded={refresh} />
      ),
      {
        ariaLabel: copy.familyAddMemberAction,
        title: copy.familyAddMemberAction,
      },
    );
  const removeMember = (memberId) =>
    setState((current) => ({
      ...current,
      members: current.members.filter((member) => member.id !== memberId),
    }));
  const updateMember = (updatedMember) =>
    setState((current) => ({
      ...current,
      members: current.members.map((member) =>
        member.id === updatedMember.id ? updatedMember : member,
      ),
    }));
  const updateShareSubscription = async (next) => {
    setShareSubscription(next);
    const response = await fetch("/api/account/family/subscription-sharing", {
      body: JSON.stringify({ shareSubscription: next }),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    if (!response.ok) {
      setShareSubscription(!next);
      showToast({
        message: copy.familyUpdateSettingsErrorGeneric,
        type: "error",
      });
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <header className="flex flex-wrap justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{copy.accountSettingsFamilies}</h1>
          <p className="mt-1 text-sm text-white/70">
            {copy.accountSettingsFamiliesDescription}
          </p>
        </div>
        {state.canManage && activeCategory === "members"
          ? <div className="flex gap-2">
              <button
                className="rounded-xl border border-purple-200/20 bg-purple-600/45! px-3 py-2 text-sm font-bold text-white transition hover:bg-purple-500/60!"
                onClick={openCreateChild}
                type="button"
              >
                {copy.familyCreateChildAction}
              </button>
              <button
                className="rounded-xl border border-white/15 bg-white/5! px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/10!"
                onClick={openAddMember}
                type="button"
              >
                {copy.familyAddMemberAction}
              </button>
            </div>
          : null}
      </header>
      <div
        className="flex gap-1 rounded-2xl border border-white/10 bg-white/5! p-1"
        role="tablist"
      >
        {[
          ["members", copy.accountSettingsFamilies, "family_group"],
          ["subscriptions", copy.billingSubscriptions, "subscriptions"],
        ].map(([value, label, icon]) => (
          <button
            aria-selected={activeCategory === value}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl p-2 ${activeCategory === value ? "bg-purple-600/45!" : "text-white/65"}`}
            key={value}
            onClick={() => setActiveCategory(value)}
            role="tab"
            type="button"
          >
            <icon>{icon}</icon>
            {label}
          </button>
        ))}
      </div>
      {activeCategory === "members"
        ? <section className="space-y-2">
            {state.loaded && !state.canManage
              ? <p className="rounded-2xl bg-amber-500/15! p-4 text-sm text-amber-50">
                  {copy.familyManagedByParentNotice}
                </p>
              : null}
            {loadError
              ? <button
                  className="rounded-xl border border-white/15 bg-white/5! px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10!"
                  onClick={refresh}
                  type="button"
                >
                  {copy.retry}
                </button>
              : state.loaded && state.members.length === 0
                ? <p className="rounded-2xl border border-dashed border-white/15 p-6 text-center text-sm text-white/60">
                    {copy.familyEmptyState}
                  </p>
                : state.members.map((member) => (
                    <MemberCard
                      canManage={state.canManage}
                      copy={copy}
                      key={member.id}
                      member={member}
                      onRemoved={removeMember}
                      onUpdated={updateMember}
                    />
                  ))}
          </section>
        : <FamilySubscriptions
            canManage={state.canManage}
            copy={copy}
            onCheckout={(planId, currency) => setCheckout({ currency, planId })}
            preferences={preferences}
          />}
      {state.canManage
        ? <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5! p-3">
            <span>
              <strong>{copy.familyShareSubscription}</strong>
              <small className="block text-white/60">
                {copy.familyShareSubscriptionDescription}
              </small>
            </span>
            <CustomToggle
              checked={shareSubscription}
              label={copy.familyShareSubscription}
              onChange={updateShareSubscription}
            />
          </div>
        : null}
      {checkout
        ? <CheckoutModal
            close={() => setCheckout(null)}
            copy={copy}
            currency={checkout.currency}
            planId={checkout.planId}
            title={copy.billingSubscriptions}
          />
        : null}
    </div>
  );
}
