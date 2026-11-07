import { execFileSync } from "node:child_process";

export default {
  name: "Kite",
  identifier: "dev.kitehq.desktop",
  version:
    process.env.KITE_DESKTOP_VERSION ||
    execFileSync("bash", ["scripts/get-version.sh"], { encoding: "utf8" })
      .trim()
      .replace(/^v/, ""),
  icon: "ui/src/assets/desktop-icon.png",
  out: "bin/desktop",
  bindings: "ui/src/lib/mygo.ts",
  i18n: { dir: "desktoplocales", source: "en" },
  updates: {
    publicKey: "J6Gj81LvnrQNfqhPx/zBeWc8eUb2hkyMTjpKS5QR6Fk=",
    github: "kite-org/kite",
    ...(process.env.KITE_DESKTOP_CHANGELOG && {
      changelog: process.env.KITE_DESKTOP_CHANGELOG,
    }),
  },
  macos: {
    signingIdentity: "-",
    minimumSystemVersion: "13.0",
  },
};
