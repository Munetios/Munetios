"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import DropdownWrapper from "../../../components/dropdownwrapper";
import { openFeedbackModal } from "../../../components/feedbackModal";
import { t } from "../../../i18n";

const organizationStorageKey = "munetios.omniwrite.organization";
const primarySidebarItems = [
  {
    icon: "browse",
    id: "templatesSidebarNavigation",
    key: "omniWriteTemplates",
  },
  { icon: "image", id: "imagesSidebarNavigation", key: "omniWriteImages" },
  { id: "aiSidebarNavigation", imageSrc: "/ai.png", key: "productAiName" },
  {
    icon: "extension",
    id: "pluginsSidebarNavigation",
    key: "omniWritePlugins",
  },
  { icon: "note", id: "notesSidebarNavigation", key: "omniWriteNotes" },
  { icon: "task_alt", id: "tasksSidebarNavigation", key: "omniWriteTasks" },
];
const bottomSidebarItems = [
  { icon: "settings", id: "settingsSidebarNavigation", key: "settings" },
  { id: "compactMoreSidebarNavigation", type: "compactMore" },
  { icon: "help", id: "helpSidebarNavigation", key: "omniWriteHelp" },
  { icon: "delete", id: "trashSidebarNavigation", key: "omniWriteTrash" },
  {
    icon: "feedback",
    id: "feedbackSidebarNavigation",
    key: "businessFeedback",
  },
];
const compactMoreItems = [
  { icon: "note", key: "omniWriteNotes" },
  { icon: "task_alt", key: "omniWriteTasks" },
  { icon: "help", key: "omniWriteHelp" },
  { icon: "delete", key: "omniWriteTrash" },
];

function useTranslatedCopy() {
  const [copy, setCopy] = useState(() => t());

  useEffect(() => {
    const refreshCopy = () => setCopy(t());

    window.addEventListener("languagechange", refreshCopy);
    window.addEventListener("munetios:languagechange", refreshCopy);
    window.addEventListener("munetios:localechange", refreshCopy);

    return () => {
      window.removeEventListener("languagechange", refreshCopy);
      window.removeEventListener("munetios:languagechange", refreshCopy);
      window.removeEventListener("munetios:localechange", refreshCopy);
    };
  }, []);

  return copy;
}

function SidebarNavigationItem({ icon, id, imageSrc, labelKey, onClick }) {
  const copy = t();

  return (
    <button
      className="omniwrite-sidebar-nav-item group flex w-full cursor-pointer items-center gap-3 text-left"
      id={id}
      onClick={onClick}
      type="button"
    >
      <span className="omniwrite-sidebar-nav-icon flex shrink-0 items-center justify-center">
        {imageSrc
          ? // biome-ignore lint/performance/noImgElement: Munetios AI uses the existing branded raster asset.
            <img
              alt=""
              aria-hidden="true"
              className="h-5 w-5 object-contain"
              src={imageSrc}
            />
          : <icon>{icon}</icon>}
      </span>
      <span
        className="min-w-0 flex-1 truncate text-[0.95rem] font-medium"
        data-translate={labelKey}
      >
        {copy[labelKey]}
      </span>
    </button>
  );
}

function OrganizationMenu({ copy, organization, setOrganization, triggerId }) {
  const chooseOrganization = (nextOrganization) => {
    setOrganization(nextOrganization);
    try {
      window.localStorage.setItem(organizationStorageKey, nextOrganization);
    } catch {
      return;
    }
  };

  return (
    <DropdownWrapper
      align="right"
      ariaLabel={copy.omniWriteMoreOptions}
      buttonClassName="omniwrite-group-action flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-transparent! transition hover:bg-white/10!"
      panelClassName="w-[min(18rem,calc(100vw-1rem))]"
      persistent
      trigger={<icon>more_horiz</icon>}
      triggerAs="div"
      triggerId={triggerId}
      zIndex={2200}
    >
      <div className="px-3 pb-1 pt-1 text-xs font-semibold uppercase tracking-[0.12em] text-white/55">
        <span data-translate="omniWriteOrganizeBy">
          {copy.omniWriteOrganizeBy}
        </span>
      </div>
      {[
        {
          key: "omniWriteOrganizeByFolders",
          value: "folders",
        },
        {
          key: "omniWriteOrganizeByDocumentList",
          value: "documents",
        },
      ].map((option) => (
        <button
          aria-checked={organization === option.value}
          className="flex w-full items-center justify-between gap-3 rounded-xl bg-transparent px-3 py-2.5 text-left text-sm text-white transition hover:bg-white/10!"
          data-dropdown-close
          key={option.value}
          onClick={() => chooseOrganization(option.value)}
          role="menuitemradio"
          type="button"
        >
          <span data-translate={option.key}>{copy[option.key]}</span>
          <icon
            className={
              organization === option.value
                ? "text-purple-200"
                : "invisible opacity-0"
            }
          >
            check
          </icon>
        </button>
      ))}
    </DropdownWrapper>
  );
}

function CompactSidebarMoreMenu({ copy }) {
  return (
    <DropdownWrapper
      align="right"
      ariaLabel={copy.omniWriteMore}
      buttonClassName="omniwrite-sidebar-nav-item group flex w-full cursor-pointer items-center gap-3 text-left"
      className="omniwrite-sidebar-more-item w-full"
      panelClassName="w-[min(18rem,calc(100vw-1rem))]"
      persistent
      trigger={
        <>
          <span className="omniwrite-sidebar-nav-icon flex shrink-0 items-center justify-center">
            <icon>more_horiz</icon>
          </span>
          <span
            className="min-w-0 flex-1 truncate text-[0.95rem] font-medium"
            data-translate="omniWriteMore"
          >
            {copy.omniWriteMore}
          </span>
        </>
      }
      triggerAs="div"
      triggerId="moreSidebarNavigation"
      zIndex={2200}
    >
      <div className="space-y-1">
        {compactMoreItems.map((item) => (
          <div
            className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-white transition hover:bg-white/10!"
            data-dropdown-close
            key={item.key}
            role="menuitem"
            tabIndex={0}
          >
            <icon>{item.icon}</icon>
            <span data-translate={item.key}>{copy[item.key]}</span>
          </div>
        ))}
      </div>
    </DropdownWrapper>
  );
}

function GroupActionButton({ ariaLabel, icon, labelKey }) {
  return (
    <button
      aria-label={ariaLabel}
      className="omniwrite-group-action flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-transparent! transition hover:bg-white/10!"
      data-translate-aria-label={labelKey}
      type="button"
    >
      <icon>{icon}</icon>
    </button>
  );
}

function SidebarGroup({ actions, copy, icon, labelKey }) {
  return (
    <section className="omniwrite-sidebar-group">
      <div className="omniwrite-sidebar-group-header flex items-center gap-2">
        <icon className="text-[18px] text-white/55">{icon}</icon>
        <h2
          className="min-w-0 flex-1 truncate text-xs font-bold uppercase tracking-[0.12em] text-white/60"
          data-translate={labelKey}
        >
          {copy[labelKey]}
        </h2>
        <div className="omniwrite-sidebar-group-actions flex items-center gap-0.5">
          {actions}
        </div>
      </div>
    </section>
  );
}

export default function OmniWriteSidebar({ open, onToggle }) {
  const copy = useTranslatedCopy();
  const [organization, setOrganization] = useState("folders");

  useEffect(() => {
    try {
      const savedOrganization = window.localStorage.getItem(
        organizationStorageKey,
      );
      if (
        savedOrganization === "folders" ||
        savedOrganization === "documents"
      ) {
        setOrganization(savedOrganization);
      }
    } catch {
      return;
    }
  }, []);

  const navigationItems = [...primarySidebarItems];
  if (organization === "documents") {
    navigationItems.splice(1, 0, {
      icon: "folder",
      id: "foldersSidebarNavigation",
      key: "omniWriteFolders",
    });
  }

  return (
    <omniwrite-sidebar
      aria-hidden={!open}
      className="omniwrite-sidebar liquid-glass flex flex-col"
    >
      <header className="omniwrite-sidebar-header flex w-full items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <button
            aria-label={copy.omniWriteCloseSidebar}
            className="omniwrite-menu-button flex h-10 w-10 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-white/10!"
            data-translate-aria-label="omniWriteCloseSidebar"
            id="toggleSidebar"
            onClick={onToggle}
            type="button"
          >
            <icon>left_panel_close</icon>
          </button>
          <div className="omniwrite-sidebar-brand flex min-w-0 items-center gap-2.5">
            <Image
              alt={copy.omniWriteLogoAlt}
              className="h-8 w-8 shrink-0 rounded-lg"
              data-translate-alt="omniWriteLogoAlt"
              height="32"
              src="/omniwrite-192.png"
              width="32"
            />
            <span className="truncate text-lg font-semibold tracking-[-0.01em]">
              OmniWrite
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1" id="sidebar-actions">
          <GroupActionButton
            ariaLabel={copy.omniWriteCreateDocument}
            icon="add"
            labelKey="omniWriteCreateDocument"
          />
          <GroupActionButton
            ariaLabel={copy.omniWriteSearchDocuments}
            icon="search"
            labelKey="omniWriteSearchDocuments"
          />
        </div>
      </header>

      <div className="omniwrite-sidebar-scroll min-h-0 flex-1 overflow-y-auto">
        <nav
          aria-label={copy.omniWriteSidebarNavigation}
          className="omniwrite-sidebar-navigation flex flex-col"
          data-translate-aria-label="omniWriteSidebarNavigation"
          id="sidebarNavigation"
        >
          {navigationItems.map((item) => (
            <SidebarNavigationItem
              icon={item.icon}
              id={item.id}
              imageSrc={item.imageSrc}
              key={item.id}
              labelKey={item.key}
            />
          ))}
        </nav>

        <div className="omniwrite-sidebar-groups flex flex-col">
          <SidebarGroup
            actions={
              <OrganizationMenu
                copy={copy}
                organization={organization}
                setOrganization={setOrganization}
                triggerId="pinnedGroupMore"
              />
            }
            copy={copy}
            icon="push_pin"
            labelKey="omniWritePinned"
          />
          {organization === "folders"
            ? <SidebarGroup
                actions={
                  <>
                    <GroupActionButton
                      ariaLabel={copy.omniWriteCreateFolder}
                      icon="add"
                      labelKey="omniWriteCreateFolder"
                    />
                    <OrganizationMenu
                      copy={copy}
                      organization={organization}
                      setOrganization={setOrganization}
                      triggerId="foldersGroupMore"
                    />
                  </>
                }
                copy={copy}
                icon="folder"
                labelKey="omniWriteFolders"
              />
            : null}
          <SidebarGroup
            actions={
              <>
                <GroupActionButton
                  ariaLabel={copy.omniWriteSearchDocuments}
                  icon="search"
                  labelKey="omniWriteSearchDocuments"
                />
                <GroupActionButton
                  ariaLabel={copy.omniWriteCreateDocument}
                  icon="note_add"
                  labelKey="omniWriteCreateDocument"
                />
                <OrganizationMenu
                  copy={copy}
                  organization={organization}
                  setOrganization={setOrganization}
                  triggerId="documentsGroupMore"
                />
              </>
            }
            copy={copy}
            icon="description"
            labelKey="omniWriteDocuments"
          />
        </div>
      </div>

      <nav
        aria-label={copy.omniWriteSidebarUtilities}
        className="omniwrite-sidebar-bottom flex flex-col"
        data-translate-aria-label="omniWriteSidebarUtilities"
      >
        {bottomSidebarItems.map((item) =>
          item.type === "compactMore"
            ? <CompactSidebarMoreMenu copy={copy} key={item.id} />
            : <SidebarNavigationItem
                icon={item.icon}
                id={item.id}
                key={item.id}
                labelKey={item.key}
                onClick={
                  item.key === "businessFeedback"
                    ? () => openFeedbackModal({ context: "omniwrite" })
                    : item.key === "omniWriteHelp"
                      ? () => window.location.assign("/help")
                    : undefined
                }
              />,
        )}
      </nav>
    </omniwrite-sidebar>
  );
}
