import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

test("published prereleases target beta Linux repositories", () => {
  const workflow = parse(readFileSync(".github/workflows/publish-repo.yml", "utf8"));
  const job = workflow.jobs["build-repo"];

  expect(job.env.REPO_CHANNEL).toContain("github.event.release.prerelease");
  expect(job.env.REPO_DIR_SUFFIX).toContain("github.event.release.prerelease");

  for (const name of ["Build DEB Repo", "Build RPM Repo"]) {
    const step = job.steps.find((candidate) => candidate.name === name);
    expect(step["working-directory"]).toContain("${{ env.REPO_DIR_SUFFIX }}");
    expect(step["working-directory"]).not.toContain("inputs.channel");
  }
});

test("beta repository package versions preserve the prerelease tilde", () => {
  const workflow = parse(readFileSync(".github/workflows/publish-repo.yml", "utf8"));
  const normalizeStep = workflow.jobs["build-repo"].steps.find(
    (step) => step.name === "Normalize prerelease package versions"
  );

  expect(normalizeStep).toBeDefined();
  expect(normalizeStep.run).toContain('PKG_VERSION="${VERSION/-/\\~}"');
  expect(normalizeStep.run).toContain(
    "fedora@sha256:99e203b80b1c3d8f7e161ec10a68fd02b081ef83a3963553e513c82846b97814"
  );
  expect(normalizeStep.run).toContain('-e "PKG_VERSION=${PKG_VERSION}"');
  expect(normalizeStep.run).toContain("dnf -q install -y rpmrebuild");
  expect(normalizeStep.run).not.toContain("apt-get install -y rpm rpmrebuild");
});
