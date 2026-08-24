"use client";

import { useState } from "react";
import ApprovalDropdown from "./approvalDropdown";
import CustomToggle from "./customToggle";
import DropdownWrapper from "./dropdownwrapper";
import FamilyTimeSchedulePicker from "./familyTimeSchedulePicker";
import { showToast } from "./toast";

function ControlToggle({ checked, description, disabled, label, onChange }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5! p-3">
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-sm font-semibold">
          {label}
        </span>
        {description
          ? <span className="mt-1 block text-xs leading-5 text-white/60">
              {description}
            </span>
          : null}
      </span>
      <CustomToggle
        checked={checked}
        disabled={disabled}
        label={label}
        onChange={onChange}
      />
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <h3 className="pt-1 text-xs font-bold uppercase tracking-wide text-white/50">
      {children}
    </h3>
  );
}

export default function FamilyParentalControlsModal({
  close,
  copy,
  locale,
  member,
  onSaved,
  readOnly = false,
}) {
  const [controls, setControls] = useState(member.parentalControls);
  const [saving, setSaving] = useState(false);
  const isChild = member.role === "child";
  const update = (patch) =>
    setControls((current) => ({ ...current, ...patch }));
  const usageLimitOptions = [
    ["none", copy.familyUsageLimitNone],
    ["hourly", copy.familyUsageLimitHourly],
    ["5hour", copy.familyUsageLimit5Hour],
    ["daily", copy.familyUsageLimitDaily],
    ["weekly", copy.familyUsageLimitWeekly],
    ["monthly", copy.familyUsageLimitMonthly],
  ];

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/account/family/${member.id}`, {
        body: JSON.stringify(controls),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast({
          message: copy.familyUpdateSettingsErrorGeneric,
          type: "error",
        });
        return;
      }
      onSaved?.(payload.member);
      showToast({ message: copy.familyControlsSaved, type: "success" });
      close();
    } catch {
      showToast({
        message: copy.familyUpdateSettingsErrorGeneric,
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm leading-6 text-white/70">
        {readOnly
          ? copy.familyViewControlsDescription
          : copy.familyControlsDescription}
      </p>

      <div
        aria-disabled={readOnly}
        className={
          readOnly ? "space-y-3 opacity-70 **:pointer-events-none" : "space-y-3"
        }
      >
        <SectionTitle>{copy.familyControlsSectionAi}</SectionTitle>
        <ControlToggle
          checked={controls.allowMunetiosAi}
          description={copy.familyControlAllowAiDescription}
          label={copy.familyControlAllowAi}
          onChange={(allowMunetiosAi) => update({ allowMunetiosAi })}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <ControlToggle
            checked={controls.allowHealthAi}
            label={copy.familyControlAllowHealthAi}
            onChange={(allowHealthAi) => update({ allowHealthAi })}
          />
          <ControlToggle
            checked={controls.allowPersonalizationAi}
            label={copy.familyControlAllowPersonalizationAi}
            onChange={(allowPersonalizationAi) =>
              update({ allowPersonalizationAi })
            }
          />
          <ControlToggle
            checked={controls.allowVoiceModeAi}
            label={copy.familyControlAllowVoiceModeAi}
            onChange={(allowVoiceModeAi) => update({ allowVoiceModeAi })}
          />
          <ControlToggle
            checked={controls.allowImageGenerationAi}
            label={copy.familyControlAllowImageGenerationAi}
            onChange={(allowImageGenerationAi) =>
              update({ allowImageGenerationAi })
            }
          />
          <ControlToggle
            checked={controls.allowLocationAi}
            label={copy.familyControlAllowLocationAi}
            onChange={(allowLocationAi) => update({ allowLocationAi })}
          />
          <ControlToggle
            checked={controls.allowAgentAi}
            label={copy.familyControlAllowAgentAi}
            onChange={(allowAgentAi) => update({ allowAgentAi })}
          />
          <ControlToggle
            checked={controls.allowCodeAi}
            description={copy.familyControlAllowCodeAiDescription}
            label={copy.familyControlAllowCodeAi}
            onChange={(allowCodeAi) => update({ allowCodeAi })}
          />
        </div>

        <FamilyTimeSchedulePicker
          copy={copy}
          locale={locale}
          onChange={(aiSchedule) => update({ aiSchedule })}
          value={controls.aiSchedule}
        />

        <div className="space-y-1.5 rounded-2xl border border-white/10 bg-white/5! p-3">
          <span className="text-sm font-semibold">
            {copy.familyUsageLimitLabel}
          </span>
          <DropdownWrapper
            align="left"
            ariaLabel={copy.familyUsageLimitLabel}
            buttonClassName="w-full justify-between"
            label={
              usageLimitOptions.find(
                ([value]) => value === controls.usageLimit.type,
              )?.[1]
            }
          >
            {usageLimitOptions.map(([value, label]) => (
              <button
                aria-checked={controls.usageLimit.type === value}
                data-dropdown-close
                key={value}
                onClick={() =>
                  update({
                    usageLimit: { ...controls.usageLimit, type: value },
                  })
                }
                role="menuitemradio"
                type="button"
              >
                <span>{label}</span>
                {controls.usageLimit.type === value ? <icon>check</icon> : null}
              </button>
            ))}
          </DropdownWrapper>
          {controls.usageLimit.type !== "none"
            ? <label className="flex items-center gap-2 pt-1 text-sm">
                <span className="text-white/70">
                  {copy.familyUsageLimitMaxRequests}
                </span>
                <input
                  className="h-10 w-24 rounded-xl border border-white/15 bg-white/5! px-3 text-sm text-white outline-none focus:border-purple-300/60"
                  min={1}
                  onChange={(event) =>
                    update({
                      usageLimit: {
                        ...controls.usageLimit,
                        maxRequests: Number(event.target.value) || 0,
                      },
                    })
                  }
                  type="number"
                  value={controls.usageLimit.maxRequests || ""}
                />
              </label>
            : null}
        </div>

        <SectionTitle>{copy.familyControlsSectionAccount}</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          <ControlToggle
            checked={controls.allowExportImport}
            label={copy.familyControlAllowExportImport}
            onChange={(allowExportImport) => update({ allowExportImport })}
          />
          <ControlToggle
            checked={controls.allowMeetRecordings}
            label={copy.familyControlAllowMeetRecordings}
            onChange={(allowMeetRecordings) => update({ allowMeetRecordings })}
          />
          <ControlToggle
            checked={controls.allowTaskSharing}
            label={copy.familyControlAllowTaskSharing}
            onChange={(allowTaskSharing) => update({ allowTaskSharing })}
          />
          <ControlToggle
            checked={controls.allowWorkspaces}
            label={copy.familyControlAllowWorkspaces}
            onChange={(allowWorkspaces) => update({ allowWorkspaces })}
          />
          <ControlToggle
            checked={controls.allowPasskeys}
            label={copy.familyControlAllowPasskeys}
            onChange={(allowPasskeys) => update({ allowPasskeys })}
          />
          <ControlToggle
            checked={controls.allowMeetJoinOutsideFamily}
            description={
              copy.familyControlAllowMeetJoinOutsideFamilyDescription
            }
            label={copy.familyControlAllowMeetJoinOutsideFamily}
            onChange={(allowMeetJoinOutsideFamily) =>
              update({ allowMeetJoinOutsideFamily })
            }
          />
        </div>
        <div className="space-y-1.5 rounded-2xl border border-white/10 bg-white/5! p-3">
          <span className="text-sm font-semibold">
            {copy.familyControlAllowPayments}
          </span>
          <ApprovalDropdown
            ariaLabel={copy.familyControlAllowPayments}
            copy={copy}
            onChange={(allowPayments) => update({ allowPayments })}
            value={controls.allowPayments}
          />
        </div>

        <SectionTitle>{copy.familyControlsSectionAdvanced}</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          {member.role === "teen"
            ? <ControlToggle
                checked={controls.allowManageFamily}
                description={copy.familyControlAllowManageFamilyDescription}
                label={copy.familyControlAllowManageFamily}
                onChange={(allowManageFamily) => update({ allowManageFamily })}
              />
            : null}
          <ControlToggle
            checked={controls.allowConnectors}
            description={isChild ? copy.familyControlLockedForChild : undefined}
            disabled={isChild}
            label={copy.familyControlAllowConnectors}
            onChange={(allowConnectors) => update({ allowConnectors })}
          />
          <ControlToggle
            checked={controls.allowDeveloperMode}
            description={isChild ? copy.familyControlLockedForChild : undefined}
            disabled={isChild}
            label={copy.familyControlAllowDeveloperMode}
            onChange={(allowDeveloperMode) => update({ allowDeveloperMode })}
          />
          <ControlToggle
            checked={controls.allowGithub}
            description={
              isChild
                ? copy.familyControlLockedForChild
                : copy.familyControlAllowGithubDescription
            }
            disabled={isChild}
            label={copy.familyControlAllowGithub}
            onChange={(allowGithub) => update({ allowGithub })}
          />
          {isChild
            ? null
            : <ControlToggle
                checked={controls.allowChangeBirthday}
                label={copy.familyControlAllowChangeBirthday}
                onChange={(allowChangeBirthday) =>
                  update({ allowChangeBirthday })
                }
              />}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        {readOnly
          ? <button
              className="h-10 rounded-xl bg-[var(--accent)]! px-4 text-sm font-semibold text-white transition hover:bg-[var(--accent)]/85!"
              onClick={close}
              type="button"
            >
              {copy.familyCloseControls}
            </button>
          : <>
              <button
                className="h-10 rounded-xl px-4 text-sm font-semibold text-white/70 transition hover:bg-white/10! hover:text-white"
                onClick={close}
                type="button"
              >
                {copy.cancel}
              </button>
              <button
                className="h-10 rounded-xl bg-[var(--accent)]! px-4 text-sm font-semibold text-white transition hover:bg-[var(--accent)]/85! disabled:opacity-50"
                disabled={saving}
                onClick={save}
                type="button"
              >
                {saving ? copy.familySaving : copy.familySaveControls}
              </button>
            </>}
      </div>
    </div>
  );
}
