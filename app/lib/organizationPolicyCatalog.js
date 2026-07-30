const corePolicies = [
  ["ManagedWorkspaces", "Workspaces", "Manage workspace restrictions"],
  ["ForceConnectorsList", "Connectors", "Force an approved connector list"],
  ["DisallowConnectors", "Connectors", "Disallow all connectors"],
  ["AllowConnectors", "Connectors", "Allow connectors"],
  ["AllowMunetiosMeet", "Apps", "Allow Munetios Meet"],
  ["AllowMunetiosTasks", "Apps", "Allow Munetios Tasks"],
  ["AIFeaturesEnabled", "AI", "Allow AI features"],
  ["AllowMunetiosAI", "Apps", "Allow Munetios AI"],
  ["AllowMunetiosDrive", "Apps", "Allow Munetios Drive"],
  ["AllowMunetiosOmniWrite", "Apps", "Allow Munetios OmniWrite"],
  ["AllowMunetiosSheets", "Apps", "Allow Munetios Sheets"],
  ["AllowMunetiosSlides", "Apps", "Allow Munetios Slides"],
  ["AllowConnectorStore", "Apps", "Allow the Connector Store"],
  ["AllowMunetiosMail", "Apps", "Allow Munetios Mail"],
  ["AllowMunetiosCalendar", "Apps", "Allow Munetios Calendar"],
  ["AllowMunetiosChat", "Apps", "Allow Munetios Chat"],
  ["AllowExternalSharing", "Sharing", "Allow external sharing"],
  ["AllowPublicLinks", "Sharing", "Allow public links"],
  [
    "RequireTwoFactorAuthentication",
    "Security",
    "Require two-factor authentication",
  ],
  ["RequirePasskeys", "Security", "Require passkeys"],
  ["AllowDataExport", "Data", "Allow data export"],
  ["AllowAccountRecovery", "Security", "Allow account recovery"],
  ["AllowWorkspaceCreation", "Workspaces", "Allow workspace creation"],
  ["AllowWorkspaceDeletion", "Workspaces", "Allow workspace deletion"],
  ["AllowWorkspaceRename", "Workspaces", "Allow workspace renaming"],
];

const resources = [
  "Tasks",
  "Meetings",
  "Files",
  "Documents",
  "Sheets",
  "Slides",
  "Mail",
  "Calendar",
  "Chats",
  "Contacts",
  "Workspaces",
  "Connectors",
  "Automations",
  "Reports",
  "Templates",
];
const actions = [
  "Create",
  "Read",
  "Edit",
  "Delete",
  "Share",
  "Export",
  "Print",
  "Archive",
];

export const organizationPolicyCatalog = Object.freeze([
  ...corePolicies.map(([key, category, label]) => ({
    category,
    defaultValue: !key.startsWith("Disallow") && !key.startsWith("Force"),
    key,
    label,
  })),
  ...resources.flatMap((resource) =>
    actions.map((action) => ({
      category: resource,
      defaultValue: true,
      key: `Allow${resource}${action}`,
      label: `Allow ${action.toLowerCase()} for ${resource.toLowerCase()}`,
    })),
  ),
]);

export function getDefaultOrganizationPolicies() {
  return Object.fromEntries(
    organizationPolicyCatalog.map((policy) => [
      policy.key,
      policy.defaultValue,
    ]),
  );
}
