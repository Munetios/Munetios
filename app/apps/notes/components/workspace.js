"use client";

import { useEffect, useState } from "react";

const bannerStorageKey = "munetios.supanotes.signInBannerDismissed";

export default function NotesWorkspace({ copy, notes = [], sessionState }) {
  const [bannerDismissed, setBannerDismissed] = useState(true);

  useEffect(() => {
    setBannerDismissed(
      window.localStorage.getItem(bannerStorageKey) === "true",
    );
  }, []);

  const dismissBanner = () => {
    window.localStorage.setItem(bannerStorageKey, "true");
    setBannerDismissed(true);
  };

  return (
    <div className="notes-workspace">
      {sessionState === "inactive" && !bannerDismissed
        ? <section className="notes-sign-in-banner liquid-glass">
            <span className="notes-banner-icon" aria-hidden="true">
              <icon>cloud_sync</icon>
            </span>
            <div>
              <h1>{copy.notesSignInBannerTitle}</h1>
              <p>{copy.notesSignInBannerBody}</p>
            </div>
            <a className="notes-banner-sign-in" href="/signin">
              {copy.notesSignIn}
            </a>
            <button
              aria-label={copy.notesDismissBanner}
              className="notes-banner-close"
              onClick={dismissBanner}
              title={copy.notesDismissBanner}
              type="button"
            >
              <icon>close</icon>
            </button>
          </section>
        : null}

      {notes.length === 0
        ? <section className="notes-empty-state liquid-glass">
            <span aria-hidden="true" className="notes-empty-icon">
              <icon>note_stack</icon>
            </span>
            <h2>{copy.notesEmptyTitle}</h2>
            <p>{copy.notesEmptyBody}</p>
          </section>
        : <section className="notes-imported-grid">
            {notes
              .filter((note) => !note.trashed)
              .map((note) => (
                <article
                  className="notes-imported-card liquid-glass"
                  key={note.id}
                >
                  <icon>note</icon>
                  <h2>{note.title || copy.notesNotesList}</h2>
                  {note.content
                    ? <p>{String(note.content).slice(0, 220)}</p>
                    : null}
                </article>
              ))}
          </section>}
    </div>
  );
}
