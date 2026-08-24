"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import CustomToggle from "./customToggle";
import DatePicker from "./datePicker";
import DropdownWrapper from "./dropdownwrapper";
import { showModal } from "./modal";
import { showToast } from "./toast";

const emptyStudent = {
  birthDate: "",
  captchaAnswer: "",
  confirmPassword: "",
  email: "",
  firstName: "",
  gender: "",
  lastName: "",
  password: "",
};

function Field({ label, ...props }) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold text-white/80">
      {label}
      <input
        className="h-11 rounded-xl border border-white/10 bg-purple-950/35! px-3 outline-none focus:border-purple-300/55"
        {...props}
      />
    </label>
  );
}

function DeleteStudentForm({ close, copy, onDeleted, student }) {
  const [working, setWorking] = useState(false);
  return (
    <div className="grid gap-4">
      <p className="text-sm leading-6 text-white/70">
        {copy.educationDeleteStudentDescription.replace(
          "{student}",
          student.name || student.email,
        )}
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <button
          className="rounded-xl border border-white/10 bg-white/8! px-4 py-2 text-sm font-bold"
          disabled={working}
          onClick={close}
          type="button"
        >
          {copy.cancel}
        </button>
        <button
          className="liquid-glass rounded-xl bg-red-600/75! px-4 py-2 text-sm font-bold disabled:opacity-55"
          disabled={working}
          onClick={async () => {
            setWorking(true);
            const response = await fetch("/api/education/students", {
              body: JSON.stringify({ studentId: student.id }),
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              method: "DELETE",
            });
            if (!response.ok) {
              setWorking(false);
              showToast({
                messageKey: "educationDeleteStudentFailed",
                type: "error",
              });
              return;
            }
            onDeleted(student.id);
            close();
            showToast({
              messageKey: "educationStudentDeleted",
              type: "success",
            });
          }}
          type="button"
        >
          {working ? copy.accountProcessing : copy.educationDeleteStudent}
        </button>
      </div>
    </div>
  );
}

function AddStudentForm({ close, copy, onCreated }) {
  const [form, setForm] = useState(emptyStudent);
  const [captcha, setCaptcha] = useState(null);
  const [working, setWorking] = useState(false);
  const loadCaptcha = useCallback(async () => {
    const response = await fetch("/api/auth/captcha", { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (response.ok) setCaptcha(payload);
  }, []);
  useEffect(() => {
    void loadCaptcha();
  }, [loadCaptcha]);
  const update = (key) => (event) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));
  return (
    <form
      className="grid gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setWorking(true);
        const response = await fetch("/api/education/students", {
          body: JSON.stringify({
            ...form,
            captchaChallengeId: captcha?.challengeId,
          }),
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          showToast({
            messageKey:
              payload?.error === "email_taken"
                ? "authEmailTaken"
                : payload?.error === "invalid_captcha"
                  ? "authCaptchaInvalid"
                  : "fetchError",
            type: "error",
          });
          setWorking(false);
          void loadCaptcha();
          return;
        }
        onCreated(payload.student);
        close();
        showToast({ messageKey: "educationStudentAdded", type: "success" });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label={copy.authFirstName}
          onChange={update("firstName")}
          required
          value={form.firstName}
        />
        <Field
          label={copy.familyChildLastName}
          onChange={update("lastName")}
          required
          value={form.lastName}
        />
        <Field
          label={copy.authEmailAddress}
          onChange={update("email")}
          required
          type="email"
          value={form.email}
        />
      </div>
      <DatePicker
        copy={copy}
        label={copy.authBirthday}
        maximumYear={new Date().getFullYear()}
        onChange={(birthDate) =>
          setForm((current) => ({ ...current, birthDate }))
        }
        value={form.birthDate}
      />
      <div className="grid gap-1.5 text-sm font-semibold text-white/80">
        <span>{copy.accountProfileGender}</span>
        <DropdownWrapper
          align="left"
          ariaLabel={copy.accountProfileGender}
          buttonClassName="h-11 w-full justify-between rounded-xl border border-white/10 bg-purple-950/35! px-3 text-left"
          label={
            {
              woman: copy.authGenderWoman,
              man: copy.authGenderMan,
              nonbinary: copy.authGenderNonBinary,
              other: copy.authGenderOther,
            }[form.gender] || copy.accountProfileGenderSelect
          }
          panelClassName="w-full"
        >
          {[
            ["woman", copy.authGenderWoman],
            ["man", copy.authGenderMan],
            ["nonbinary", copy.authGenderNonBinary],
            ["other", copy.authGenderOther],
          ].map(([value, label]) => (
            <button
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-white/10!"
              key={value}
              onClick={() =>
                setForm((current) => ({ ...current, gender: value }))
              }
              type="button"
            >
              {label}
              {form.gender === value ? <icon>check</icon> : null}
            </button>
          ))}
        </DropdownWrapper>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label={copy.signInPassword}
          minLength={8}
          onChange={update("password")}
          required
          type="password"
          value={form.password}
        />
        <Field
          label={copy.accountSecurityConfirmPassword}
          minLength={8}
          onChange={update("confirmPassword")}
          required
          type="password"
          value={form.confirmPassword}
        />
      </div>
      {captcha?.imageUrl
        ? <Image
            alt={copy.authCaptchaAlt}
            className="max-w-full rounded-xl"
            height={90}
            src={captcha.imageUrl}
            unoptimized
            width={280}
          />
        : null}
      <Field
        label={copy.authCaptchaLabel}
        onChange={update("captchaAnswer")}
        required
        value={form.captchaAnswer}
      />
      <button
        className="liquid-glass rounded-xl bg-purple-600/75! px-4 py-3 font-bold disabled:opacity-55"
        disabled={working}
        type="submit"
      >
        {working ? copy.accountProcessing : copy.createMunetiosAccount}
      </button>
    </form>
  );
}

function AssignTaskForm({ close, copy, student }) {
  const [working, setWorking] = useState(false);
  const [dueDate, setDueDate] = useState("");
  return (
    <form
      className="grid gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setWorking(true);
        const data = new FormData(event.currentTarget);
        const response = await fetch("/api/education/students", {
          body: JSON.stringify({
            action: "assign_task",
            description: data.get("description"),
            dueDate,
            studentId: student.id,
            title: data.get("title"),
          }),
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        if (!response.ok) {
          showToast({ messageKey: "fetchError", type: "error" });
          setWorking(false);
          return;
        }
        close();
        showToast({ messageKey: "educationTaskAssigned", type: "success" });
      }}
    >
      <p className="text-sm text-white/65">
        {copy.educationTeacherAssigned}: {student.name}
      </p>
      <Field label={copy.tasksTaskName} maxLength={160} name="title" required />
      <label className="grid gap-1.5 text-sm font-semibold text-white/80">
        {copy.tasksDescription}
        <textarea
          className="min-h-24 rounded-xl border border-white/10 bg-purple-950/35! p-3 outline-none"
          maxLength={1000}
          name="description"
        />
      </label>
      <DatePicker
        copy={copy}
        label={copy.tasksDueDate}
        minimumYear={new Date().getFullYear()}
        onChange={setDueDate}
        value={dueDate}
      />
      <button
        className="liquid-glass rounded-xl bg-purple-600/75! px-4 py-3 font-bold"
        disabled={working}
        type="submit"
      >
        {copy.educationTeacherAssigned}
      </button>
    </form>
  );
}

function ManageStudentForm({ close, copy, onSaved, student }) {
  const [form, setForm] = useState({
    aiAllowed: student.aiAllowed === true,
    bio: student.bio || "",
    birthDate: student.birthDate || "",
    email: student.email || "",
    firstName: student.firstName || "",
    gender: student.gender || "",
    lastName: student.lastName || "",
    password: "",
  });
  const [working, setWorking] = useState(false);
  const update = (key) => (event) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));
  const genderOptions = [
    ["woman", copy.authGenderWoman],
    ["man", copy.authGenderMan],
    ["nonbinary", copy.authGenderNonBinary],
    ["other", copy.authGenderOther],
  ];
  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        if (
          !form.firstName.trim() ||
          !form.lastName.trim() ||
          !form.email.trim() ||
          !form.birthDate ||
          !form.gender
        ) {
          showToast({ messageKey: "authRequiredDetails", type: "error" });
          return;
        }
        setWorking(true);
        const response = await fetch("/api/education/students", {
          body: JSON.stringify({
            settings: {
              aiAllowed: form.aiAllowed,
              ...(form.password ? { password: form.password } : {}),
              profile: {
                birthDate: form.birthDate,
                bio: form.bio,
                email: form.email,
                firstName: form.firstName,
                gender: form.gender,
                lastName: form.lastName,
              },
            },
            studentId: student.id,
          }),
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          method: "PATCH",
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          showToast({
            messageKey: "educationStudentSettingsFailed",
            type: "error",
          });
          setWorking(false);
          return;
        }
        onSaved(payload.student);
        close();
        showToast({
          messageKey: "educationStudentSettingsSaved",
          type: "success",
        });
      }}
    >
      <div className="flex items-center justify-between gap-3 rounded-xl border border-purple-200/15 bg-purple-500/10! p-3">
        <span>
          <strong className="block text-sm">{copy.educationAllowAi}</strong>
          <small className="text-white/60">
            {copy.educationAllowAiDescription}
          </small>
        </span>
        <CustomToggle
          checked={form.aiAllowed}
          label={copy.educationAllowAi}
          onChange={(aiAllowed) =>
            setForm((current) => ({ ...current, aiAllowed }))
          }
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label={copy.authFirstName}
          onChange={update("firstName")}
          required
          value={form.firstName}
        />
        <Field
          label={copy.familyChildLastName}
          onChange={update("lastName")}
          required
          value={form.lastName}
        />
      </div>
      <Field
        label={copy.authEmailAddress}
        onChange={update("email")}
        required
        type="email"
        value={form.email}
      />
      <DatePicker
        copy={copy}
        label={copy.authBirthday}
        maximumYear={new Date().getFullYear()}
        onChange={(birthDate) =>
          setForm((current) => ({ ...current, birthDate }))
        }
        value={form.birthDate}
      />
      <label className="grid gap-1.5 text-sm font-semibold text-white/80">
        <span className="flex items-center justify-between gap-3">
          <span>{copy.accountProfileBio}</span>
          <small className="text-white/45">{form.bio.length} / 1000</small>
        </span>
        <textarea
          className="min-h-24 resize-y rounded-xl border border-white/10 bg-purple-950/35! p-3 outline-none focus:border-purple-300/55"
          maxLength={1000}
          onChange={update("bio")}
          placeholder={copy.accountProfileBioPlaceholder}
          rows={4}
          value={form.bio}
        />
      </label>
      <div className="grid gap-1.5 text-sm font-semibold text-white/80">
        <span>{copy.accountProfileGender}</span>
        <DropdownWrapper
          align="left"
          ariaLabel={copy.accountProfileGender}
          buttonClassName="h-11 w-full justify-between rounded-xl border border-white/10 bg-purple-950/35! px-3 text-left"
          label={
            genderOptions.find(([value]) => value === form.gender)?.[1] ||
            copy.accountProfileGenderSelect
          }
          panelClassName="w-full"
        >
          {genderOptions.map(([value, label]) => (
            <button
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-white/10!"
              key={value}
              onClick={() =>
                setForm((current) => ({ ...current, gender: value }))
              }
              type="button"
            >
              {label}
              {form.gender === value ? <icon>check</icon> : null}
            </button>
          ))}
        </DropdownWrapper>
      </div>
      <Field
        autoComplete="new-password"
        label={copy.accountSecurityNewPassword}
        minLength={8}
        onChange={update("password")}
        type="password"
        value={form.password}
      />
      <p className="text-xs leading-5 text-white/55">
        {copy.educationPasswordOptionalDescription}
      </p>
      <button
        className="liquid-glass rounded-xl bg-purple-600/75! px-4 py-3 font-bold disabled:opacity-55"
        disabled={working}
        type="submit"
      >
        {working ? copy.accountProcessing : copy.educationSaveStudentSettings}
      </button>
    </form>
  );
}

export default function AccountStudentsSection({ copy }) {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch("/api/education/students", { credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => setStudents(payload?.students || []))
      .catch(() => showToast({ messageKey: "fetchError", type: "error" }))
      .finally(() => setLoading(false));
  }, []);
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{copy.accountSettingsStudents}</h1>
          <p className="mt-1 text-sm leading-6 text-white/62">
            {copy.accountSettingsStudentsDescription}
          </p>
        </div>
        <button
          className="liquid-glass rounded-xl bg-purple-600/70! px-4 py-2 text-sm font-bold"
          onClick={() =>
            showModal(
              ({ close }) => (
                <AddStudentForm
                  close={close}
                  copy={copy}
                  onCreated={(student) =>
                    setStudents((items) => [...items, student])
                  }
                />
              ),
              {
                ariaLabel: `${copy.add} ${copy.educationStudent}`,
                title: `${copy.add} ${copy.educationStudent}`,
                width: "min(42rem, calc(100vw - 1rem))",
              },
            )
          }
          type="button"
        >
          <icon>person_add</icon> {copy.add} {copy.educationStudent}
        </button>
      </header>
      <p className="rounded-xl border border-purple-200/15 bg-purple-500/10! p-3 text-sm text-purple-100">
        {copy.educationClassroomComingSoon}
      </p>
      <p className="rounded-xl border border-amber-200/15 bg-amber-500/10! p-3 text-sm text-amber-50">
        {copy.educationUnavailableNote}
      </p>
      {loading ? <p className="text-sm text-white/60">{copy.loading}</p> : null}
      {!loading && !students.length
        ? <p className="rounded-xl border border-white/10 bg-white/5! p-4 text-sm text-white/60">
            {copy.educationNoStudents}
          </p>
        : null}
      <div className="grid gap-2">
        {students.map((student) => (
          <article
            className="liquid-glass flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/5! p-3"
            key={student.id}
          >
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-purple-500/20!">
              <icon>person</icon>
            </span>
            <span className="min-w-0 flex-1">
              <strong className="block truncate">{student.name}</strong>
              <small className="text-white/55">{student.email}</small>
            </span>
            <button
              className="rounded-xl border border-white/10 bg-white/8! px-3 py-2 text-sm font-bold"
              onClick={() =>
                showModal(
                  ({ close }) => (
                    <ManageStudentForm
                      close={close}
                      copy={copy}
                      onSaved={(saved) =>
                        setStudents((items) =>
                          items.map((item) =>
                            item.id === saved.id ? saved : item,
                          ),
                        )
                      }
                      student={student}
                    />
                  ),
                  {
                    ariaLabel: copy.educationManageStudent,
                    title: copy.educationManageStudent,
                    width: "min(42rem, calc(100vw - 1rem))",
                  },
                )
              }
              type="button"
            >
              {copy.educationManageStudent}
            </button>
            <button
              className="rounded-xl border border-purple-200/20 bg-purple-600/35! px-3 py-2 text-sm font-bold"
              onClick={() =>
                showModal(
                  ({ close }) => (
                    <AssignTaskForm
                      close={close}
                      copy={copy}
                      student={student}
                    />
                  ),
                  {
                    ariaLabel: copy.educationTeacherAssigned,
                    title: copy.educationTeacherAssigned,
                  },
                )
              }
              type="button"
            >
              {copy.educationTeacherAssigned}
            </button>
            <button
              className="rounded-xl border border-red-200/20 bg-red-600/25! px-3 py-2 text-sm font-bold text-red-50"
              onClick={() =>
                showModal(
                  ({ close }) => (
                    <DeleteStudentForm
                      close={close}
                      copy={copy}
                      onDeleted={(studentId) =>
                        setStudents((items) =>
                          items.filter((item) => item.id !== studentId),
                        )
                      }
                      student={student}
                    />
                  ),
                  {
                    ariaLabel: copy.educationDeleteStudent,
                    closeOnBackdrop: false,
                    title: copy.educationDeleteStudent,
                  },
                )
              }
              type="button"
            >
              <icon>delete</icon> {copy.educationDeleteStudent}
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}
