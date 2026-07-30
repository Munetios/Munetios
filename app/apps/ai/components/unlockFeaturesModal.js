"use client";

import { showModal } from "../../../components/modal";

export function openUnlockFeaturesModal(copy) {
  showModal(
    ({ close }) => (
      <div className="munetios-ai-unlock-features">
        <span aria-hidden="true">
          <icon className="munetios-ai-unlock-features-icon">lock_open</icon>
        </span>
        <p>{copy.aiUnlockFeaturesDescription}</p>
        <div>
          <button onClick={close} type="button">
            {copy.modalClose}
          </button>
          <button
            onClick={() => {
              const returnTo = `${window.location.pathname}${window.location.search}`;
              window.location.assign(
                `/signin?returnTo=${encodeURIComponent(returnTo)}`,
              );
            }}
            type="button"
          >
            {copy.signIn}
          </button>
        </div>
      </div>
    ),
    {
      ariaLabel: copy.aiUnlockFeaturesTitle,
      title: copy.aiUnlockFeaturesTitle,
      width: "min(28rem, calc(100vw - 1.5rem))",
    },
  );
}
