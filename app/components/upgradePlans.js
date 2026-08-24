"use client";

export default function UpgradePlans({ copy }) {
  return (
    <div className="liquid-glass rounded-2xl border border-purple-200/20 bg-purple-500/15! p-6 text-center text-white">
      <icon className="text-3xl text-purple-200">schedule</icon>
      <strong className="mt-2 block text-xl">{copy.comingSoon}</strong>
    </div>
  );
}
