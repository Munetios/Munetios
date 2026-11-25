"use strict";

const welcomeI18n = window.MunetiosWebFilterI18n;
welcomeI18n.load().then(() => {
  for (const element of document.querySelectorAll("[data-wf-text]")) {
    const key = element.dataset.wfText;
    const translation = welcomeI18n.t(key);
    if (translation !== key) element.textContent = translation;
  }
});
