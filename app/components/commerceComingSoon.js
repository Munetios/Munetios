export default function CommerceComingSoon({ copy, fullPage = false, title }) {
  return (
    <main
      className={`grid place-items-center bg-[var(--background)] p-4 text-[var(--foreground)] ${fullPage ? "min-h-dvh" : "min-h-80"}`}
    >
      <section className="liquid-glass w-full max-w-xl rounded-3xl border border-purple-200/20 bg-purple-950/35! p-8 text-center backdrop-blur-[3px]">
        <icon className="text-4xl text-purple-200">schedule</icon>
        <h1 className="mt-3 text-2xl font-bold">{title}</h1>
        <p className="mt-2 text-white/65">{copy.comingSoon}</p>
      </section>
    </main>
  );
}
