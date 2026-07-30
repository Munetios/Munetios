export const helpApps = [
  { icon: "task_alt", id: "tasks", name: "Munetios Tasks" },
  { icon: "videocam", id: "meet", name: "Munetios Meet" },
  { icon: "auto_awesome", id: "ai", name: "Munetios AI" },
  { icon: "edit_note", id: "omniwrite", name: "Munetios OmniWrite" },
  { icon: "manage_accounts", id: "account", name: "Munetios Account" },
];

const articleDefinitions = {
  tasks: [
    [
      "getting-started",
      "Getting started with Tasks",
      "Create, organize, and securely sync work across your account.",
    ],
    [
      "organize-and-share",
      "Organize and share tasks",
      "Use categories, favorites, statuses, and encrypted sharing.",
    ],
  ],
  meet: [
    [
      "audio-and-video",
      "Set up audio and video",
      "Choose devices, test audio, and prepare for a clear meeting.",
    ],
    [
      "history-and-privacy",
      "History and call privacy",
      "Understand call history, blocked people, and activity controls.",
    ],
  ],
  ai: [
    [
      "personalize",
      "Personalize Munetios AI",
      "Choose appearance, language, memory, voice input, and response style.",
    ],
    [
      "models-and-usage",
      "Models, tools, and usage",
      "Understand model costs, limits, attachments, and advanced tools.",
    ],
  ],
  omniwrite: [
    [
      "create-and-edit",
      "Create and edit documents",
      "Build polished documents with familiar editing tools.",
    ],
    [
      "organize-documents",
      "Organize your writing",
      "Find documents, use templates, and manage writing resources.",
    ],
  ],
  account: [
    [
      "profile-and-security",
      "Profile and security",
      "Manage identity, sign-in methods, sessions, and account recovery.",
    ],
    [
      "billing-and-appearance",
      "Billing and appearance",
      "Manage plans, invoices, themes, fonts, and language preferences.",
    ],
  ],
};

function sectionsFor(appName, title) {
  return [
    {
      id: "overview",
      title: "Overview",
      paragraphs: [
        `${title} is part of ${appName}. This guide explains the complete workflow, the account settings that affect it, and the checks you can use when something does not behave as expected.`,
        "Munetios saves supported account data securely so your work can follow you between signed-in devices. Keep the same account selected before troubleshooting a missing item, and allow a moment for a newly changed setting to synchronize.",
      ],
    },
    {
      id: "before-you-start",
      title: "Before you start",
      paragraphs: [
        "Use a current browser, verify that cookies are enabled, and confirm that the correct Munetios account appears in the account menu. Device permissions such as microphone, camera, files, notifications, and location remain controlled by your browser and operating system.",
        "If a feature requires sign-in, Munetios shows an unlock message before making an account-only request. Signing in also enables account synchronization, secure sharing, and settings that persist between devices.",
      ],
    },
    {
      id: "steps",
      title: "Step-by-step",
      paragraphs: [
        `Open ${appName}, choose the relevant item from its navigation, and review the available controls before saving. Changes that affect other people display a confirmation or permission choice when needed.`,
        "After completing the action, look for the confirmation toast or updated status. If you are working on another device, refresh that device after synchronization finishes. Avoid repeating a submission while its progress indicator is visible.",
      ],
    },
    {
      id: "privacy",
      title: "Privacy and safety",
      paragraphs: [
        "Munetios limits requests to the information needed for the selected feature. IP addresses are not displayed in the interface. Some server features may use network-derived country information for localization, fraud protection, or regional availability without exposing the address.",
        "Do not share passwords, recovery codes, payment credentials, private encryption keys, or highly sensitive personal information in shared content. Review collaborator permissions and remove access when it is no longer required.",
      ],
    },
    {
      id: "troubleshooting",
      title: "Troubleshooting",
      paragraphs: [
        "If the action does not finish, check your connection, reload the page once, and try again. For device features, reopen site permissions and confirm that the intended microphone, camera, speaker, or file is selected.",
        "If the issue continues, submit a bug report from the Help Center. Include what you expected, what happened, the app name, and steps that reliably reproduce the issue. A screenshot is helpful when it does not contain sensitive information.",
      ],
    },
    {
      id: "accessibility",
      title: "Accessibility and keyboard use",
      paragraphs: [
        "Every primary action is available from the keyboard. Use Tab and Shift+Tab to move between controls, Enter or Space to activate the focused control, and Escape to close menus and dialogs. A visible focus indicator shows which control will receive the next action.",
        "You can increase the Help Center font size, reduce motion, and choose a light, dark, or account-based theme in Settings. Browser zoom remains supported. If content becomes difficult to reach after zooming, reload once so the layout can recalculate the available width.",
      ],
    },
    {
      id: "sync-and-offline",
      title: "Synchronization and offline behavior",
      paragraphs: [
        "A local change may appear immediately while its encrypted or account-backed copy is still synchronizing. Keep the page open until its progress state clears. When the network is unavailable, supported apps retain local drafts and clearly identify actions that require a connection.",
        "If two devices edit the same item before either receives the other change, the app preserves the safest recoverable state and may ask which version to keep. Review timestamps and collaborator activity before deleting a duplicate or older revision.",
      ],
    },
    {
      id: "related-settings",
      title: "Related settings and next steps",
      paragraphs: [
        `Open the account menu to review the profile, appearance, language, security, billing, workspace, and storage settings that can affect ${appName}. App-specific settings remain inside the app so they can be changed without altering unrelated Munetios products.`,
        "For a reproducible problem, use Submit a feature request or bug report and select the exact app and category. Describe one issue per report, include the smallest safe set of steps, and attach a screenshot only after removing private account or payment information.",
      ],
    },
  ];
}

export const helpArticles = Object.fromEntries(
  Object.entries(articleDefinitions).flatMap(([appId, definitions]) => {
    const app = helpApps.find((entry) => entry.id === appId);
    return definitions.map(([id, title, summary]) => [
      `${appId}/${id}`,
      {
        appId,
        id,
        visual:
          id === definitions[0][0] && appId !== "account"
            ? {
                alt: `${app.name} demo interface`,
                caption:
                  "A focused view captured from the Munetios demo experience.",
                src: `/help/screenshots/${appId}.png`,
                tooltips: [
                  {
                    icon: "looks_one",
                    label: "Open navigation and app areas",
                    position: "top-left",
                  },
                  {
                    icon: "looks_two",
                    label: "Find the primary workspace controls",
                    position: "top-right",
                  },
                  {
                    icon: "looks_3",
                    label: "Create or continue your work",
                    position: "bottom-center",
                  },
                ],
              }
            : null,
        sections: sectionsFor(app.name, title),
        summary,
        title,
      },
    ]);
  }),
);

export function getHelpArticle(path = []) {
  const normalized = path.filter(Boolean).join("/");
  return helpArticles[normalized] || helpArticles["tasks/getting-started"];
}

export function getArticlesForApp(appId) {
  return Object.values(helpArticles).filter(
    (article) => article.appId === appId,
  );
}
