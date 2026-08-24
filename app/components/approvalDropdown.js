"use client";

import DropdownWrapper from "./dropdownwrapper";

export default function ApprovalDropdown({
  ariaLabel,
  copy,
  onChange,
  value = "require_approval",
}) {
  const options = [
    ["allow", copy.familyApprovalAllow],
    ["require_approval", copy.familyApprovalRequireApproval],
    ["disallow", copy.familyApprovalDisallow],
  ];

  return (
    <DropdownWrapper
      align="left"
      ariaLabel={ariaLabel}
      buttonClassName="w-full justify-between"
      label={options.find(([option]) => option === value)?.[1]}
    >
      {options.map(([option, label]) => (
        <button
          aria-checked={value === option}
          data-dropdown-close
          key={option}
          onClick={() => onChange(option)}
          role="menuitemradio"
          type="button"
        >
          <span>{label}</span>
          {value === option ? <icon>check</icon> : null}
        </button>
      ))}
    </DropdownWrapper>
  );
}
