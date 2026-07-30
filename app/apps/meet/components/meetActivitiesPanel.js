"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import DropdownWrapper from "../../../components/dropdownwrapper";

const timerOptions = [
  [60, "meetActivityOneMinute"],
  [300, "meetActivityFiveMinutes"],
  [600, "meetActivityTenMinutes"],
  [1800, "meetActivityThirtyMinutes"],
  [3600, "meetActivityOneHour"],
];
const wordHuntPreviewTiles = [
  ["w1", "W"],
  ["o1", "O"],
  ["r1", "R"],
  ["d1", "D"],
  ["h1", "H"],
  ["u1", "U"],
  ["n1", "N"],
  ["t1", "T"],
  ["g1", "G"],
  ["a1", "A"],
  ["m1", "M"],
  ["e1", "E"],
  ["p1", "P"],
  ["l1", "L"],
  ["a2", "A"],
  ["y1", "Y"],
];

function ActivityPicker({
  allowOthers,
  copy,
  duration,
  onDurationChange,
  onStart,
}) {
  const [boardSize, setBoardSize] = useState(4);
  const [customBoard, setCustomBoard] = useState("");
  const [creatorWord, setCreatorWord] = useState("");
  const timerLabel =
    copy[
      timerOptions.find(([seconds]) => seconds === duration)?.[1] ||
        "meetActivityFiveMinutes"
    ];
  return (
    <div className="meet-activity-picker">
      <section className="meet-activity-options liquid-glass">
        <span>
          <strong>{copy.meetActivityAnagrams}</strong>
          <small>{copy.meetActivityTimerDescription}</small>
        </span>
        <DropdownWrapper
          align="right"
          ariaLabel={copy.meetActivityTimer}
          buttonClassName="meet-activity-timer-trigger liquid-glass"
          panelClassName="w-56"
          trigger={
            <>
              <span>{timerLabel}</span>
              <icon>expand_more</icon>
            </>
          }
        >
          {timerOptions.map(([seconds, key]) => (
            <button
              className="meet-menu-item"
              data-dropdown-close
              key={seconds}
              onClick={() => onDurationChange(seconds)}
              role="menuitem"
              type="button"
            >
              <icon>
                {seconds === duration
                  ? "radio_button_checked"
                  : "radio_button_unchecked"}
              </icon>
              <span>{copy[key]}</span>
            </button>
          ))}
        </DropdownWrapper>
        <label className="meet-activity-creator-word">
          <span>{copy.meetActivityWord}</span>
          <input
            autoComplete="off"
            maxLength={12}
            onChange={(event) =>
              setCreatorWord(event.target.value.replace(/[^a-z]/giu, ""))
            }
            placeholder={copy.meetActivityWordPlaceholder}
            value={creatorWord}
          />
        </label>
        <div className="meet-activity-board-options">
          <span>
            <strong>{copy.meetActivityWordHunt}</strong>
            <small>{copy.meetActivityBoardSize}</small>
          </span>
          <DropdownWrapper
            align="right"
            ariaLabel={copy.meetActivityBoardSize}
            buttonClassName="meet-activity-timer-trigger liquid-glass"
            panelClassName="w-40"
            trigger={
              <>
                <span>
                  {boardSize} × {boardSize}
                </span>
                <icon>expand_more</icon>
              </>
            }
          >
            {[4, 5, 6, 7].map((size) => (
              <button
                className="meet-menu-item"
                data-dropdown-close
                key={size}
                onClick={() => {
                  setBoardSize(size);
                  setCustomBoard("");
                }}
                role="menuitem"
                type="button"
              >
                <icon>
                  {size === boardSize
                    ? "radio_button_checked"
                    : "radio_button_unchecked"}
                </icon>
                <span>
                  {size} × {size}
                </span>
              </button>
            ))}
          </DropdownWrapper>
          <label className="meet-activity-creator-word">
            <span>{copy.meetActivityCustomBoard}</span>
            <input
              autoComplete="off"
              maxLength={boardSize * boardSize}
              onChange={(event) =>
                setCustomBoard(
                  event.target.value.replace(/[^a-z]/giu, "").toUpperCase(),
                )
              }
              placeholder={copy.meetActivityCustomBoardPlaceholder.replace(
                "{count}",
                boardSize * boardSize,
              )}
              value={customBoard}
            />
            <small>
              {customBoard.length}/{boardSize * boardSize}
            </small>
          </label>
        </div>
      </section>
      <div className="meet-activity-cards">
        <button
          className="meet-activity-card liquid-glass"
          onClick={() => onStart("chess", { allowOthers })}
          type="button"
        >
          <Image
            alt=""
            height={1024}
            priority
            src="/meet/activities/chess.png"
            width={1536}
          />
          <span>
            <strong>{copy.meetActivityChess}</strong>
            <small>{copy.meetActivityChessDescription}</small>
          </span>
          <icon>arrow_forward</icon>
        </button>
        <button
          className="meet-activity-card liquid-glass"
          disabled={
            customBoard.length > 0 &&
            customBoard.length !== boardSize * boardSize
          }
          onClick={() =>
            onStart("wordhunt", {
              allowOthers,
              boardSize,
              customBoard: customBoard || undefined,
              durationSeconds: duration,
            })
          }
          type="button"
        >
          <span aria-hidden="true" className="meet-activity-word-hunt-preview">
            {wordHuntPreviewTiles.map(([id, letter]) => (
              <i key={id}>{letter}</i>
            ))}
          </span>
          <span>
            <strong>{copy.meetActivityWordHunt}</strong>
            <small>{copy.meetActivityWordHuntDescription}</small>
          </span>
          <icon>arrow_forward</icon>
        </button>
        <button
          className="meet-activity-card liquid-glass"
          onClick={() =>
            onStart("anagrams", {
              allowOthers,
              creatorWord: creatorWord.length >= 2 ? creatorWord : undefined,
              durationSeconds: duration,
            })
          }
          type="button"
        >
          <Image
            alt=""
            height={1024}
            priority
            src="/meet/activities/anagrams.png"
            width={1536}
          />
          <span>
            <strong>{copy.meetActivityAnagrams}</strong>
            <small>{copy.meetActivityAnagramsDescription}</small>
          </span>
          <icon>arrow_forward</icon>
        </button>
        <section className="meet-activity-coming-soon liquid-glass">
          <icon className="meet-activity-coming-soon-icon">sports_esports</icon>
          <span>
            <strong>{copy.meetActivityMoreGames}</strong>
            <small>{copy.comingSoon}</small>
          </span>
        </section>
      </div>
    </div>
  );
}

function ActivityFrame({
  activity,
  copy,
  localPeerId,
  onEnd,
  onJoin,
  onUpdate,
}) {
  const frameRef = useRef(null);
  const sendState = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage(
      {
        activity,
        copy,
        localPeerId,
        source: "munetios-meet",
        type: "state",
      },
      window.location.origin,
    );
  }, [activity, copy, localPeerId]);

  useEffect(() => {
    sendState();
  }, [sendState]);

  useEffect(() => {
    const receive = (event) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== frameRef.current?.contentWindow ||
        event.data?.source !== "munetios-activity"
      ) {
        return;
      }
      if (event.data.type === "ready") {
        sendState();
      } else if (event.data.type === "join") {
        void onJoin();
      } else if (event.data.type === "end") {
        void onEnd();
      } else if (event.data.type === "update") {
        const requestId = event.data.payload?.requestId;
        void Promise.resolve(onUpdate(event.data.payload || {})).then((ok) => {
          frameRef.current?.contentWindow?.postMessage(
            {
              ok: Boolean(ok),
              requestId,
              source: "munetios-meet",
              type: "update-result",
            },
            window.location.origin,
          );
        });
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [onEnd, onJoin, onUpdate, sendState]);

  return (
    <iframe
      allow="autoplay"
      className="meet-activity-frame"
      data-meet-record-layer="activity"
      onLoad={sendState}
      ref={frameRef}
      src={`/activity/${activity.type}`}
      title={
        activity.type === "chess"
          ? copy.meetActivityChess
          : activity.type === "wordhunt"
            ? copy.meetActivityWordHunt
            : copy.meetActivityAnagrams
      }
    />
  );
}

export function MeetActivityTile(props) {
  return (
    <article className="meet-activity-video-tile">
      <ActivityFrame {...props} />
    </article>
  );
}

export default function MeetActivitiesPanel({
  allowOthers,
  copy,
  onClose,
  onStart,
  open,
}) {
  const [duration, setDuration] = useState(300);
  if (!open) return null;
  return (
    <aside className="meet-activities-panel liquid-glass">
      <header className="meet-activities-header liquid-glass">
        <span>
          <small>{copy.meetActivityTogether}</small>
          <h2>{copy.meetActivities}</h2>
        </span>
        <button aria-label={copy.close} onClick={onClose} type="button">
          <icon>close</icon>
        </button>
      </header>
      <div className="meet-activities-content">
        <ActivityPicker
          allowOthers={allowOthers}
          copy={copy}
          duration={duration}
          onDurationChange={setDuration}
          onStart={onStart}
        />
      </div>
    </aside>
  );
}
