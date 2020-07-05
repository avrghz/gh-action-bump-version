const { Toolkit } = require("actions-toolkit");
const { execSync } = require("child_process");

const getCommitMessages = (commits) => commits.map((commit) => commit.message + "\n" + commit.body);

const checkIsVersionBump = (messages, commitMessage) =>
  messages.map((message) => message.toLowerCase().includes(commitMessage)).includes(true);

const setGitConfig = async (tools) => {
  await tools.runInWorkspace("git", [
    "config",
    "user.name",
    `"${process.env.GITHUB_USER || "Automated Version Bump"}"`,
  ]);
  await tools.runInWorkspace("git", ["config", "user.email", process.env.GITHUB_EMAIL]);
};

const getVersion = (messages) => {
  let version = "patch";
  if (messages.map((message) => message.includes("BREAKING CHANGE") || message.includes("major")).includes(true)) {
    version = "major";
  } else if (
    messages
      .map((message) => message.toLowerCase().startsWith("feat") || message.toLowerCase().includes("minor"))
      .includes(true)
  ) {
    version = "minor";
  }

  return version;
};

const performUpdateOnCurrentBranch = async (tools, current, version, commitMessage) => {
  await tools.runInWorkspace("npm", ["version", "--allow-same-version=true", "--git-tag-version=false", current]);
  console.log("current:", current, "/", "version:", version);
  const newVersion = execSync(`npm version --git-tag-version=false ${version}`).toString().trim();

  if (process.env["INPUT_SUB-PACKAGE"]) {
    console.log("Change sub package started");
    process.chdir(`${process.env.GITHUB_WORKSPACE}/${process.env["INPUT_SUB-PACKAGE"]}`);
    const updatedSubVersion = execSync(`npm version --git-tag-version=false ${newVersion}`).toString().trim();
    console.log(`Updated version of ${process.env["INPUT_SUB-PACKAGE"]}`, updatedSubVersion);
    process.chdir(process.env.GITHUB_WORKSPACE);
  }

  await tools.runInWorkspace("git", ["commit", "-a", "-m", `ci: ${commitMessage} ${newVersion}`]);
  return newVersion;
};

const performUpdateOnActualBranch = async (tools, current, version, currentBranch) => {
  await tools.runInWorkspace("git", ["checkout", currentBranch]);
  await tools.runInWorkspace("npm", ["version", "--allow-same-version=true", "--git-tag-version=false", current]);
  console.log("current:", current, "/", "version:", version);
  const newVersion = execSync(`npm version --git-tag-version=false ${version}`).toString().trim();
  const tag = `${process.env["INPUT_TAG-PREFIX"]}${newVersion}`;
  return tag;
};

const pushChanges = async (tools, tag) => {
  const remoteRepo = `https://${process.env.GITHUB_ACTOR}:${process.env.GITHUB_TOKEN}@github.com/${process.env.GITHUB_REPOSITORY}.git`;
  // console.log(Buffer.from(remoteRepo).toString('base64'))
  await tools.runInWorkspace("git", ["tag", tag]);
  await tools.runInWorkspace("git", ["push", remoteRepo, "--follow-tags"]);
  await tools.runInWorkspace("git", ["push", remoteRepo, "--tags"]);
  // await tools.runInWorkspace("git", ["push", remoteRepo]);
};

Toolkit.run(async (tools) => {
  const commitMessage = "version bump to";

  const pkg = tools.getPackageJSON();
  const event = tools.context.payload;

  const messages = getCommitMessages(event.commits);

  const isVersionBump = checkIsVersionBump(messages, commitMessage);

  if (isVersionBump) {
    tools.exit.success("No action necessary!");
    return;
  }

  const version = getVersion(messages);

  try {
    const current = pkg.version.toString();

    // set git user
    await setGitConfig(tools);

    const currentBranch = /refs\/[a-zA-Z]+\/(.*)/.exec(process.env.GITHUB_REF)[1];
    console.log("currentBranch:", currentBranch);

    // do it in the current checked out github branch (DETACHED HEAD)
    // important for further usage of the package.json version
    const newVersion = await performUpdateOnCurrentBranch(tools, current, version, commitMessage);

    // now go to the actual branch to perform the same versioning
    const tag = await performUpdateOnActualBranch(tools, current, version, currentBranch);

    console.log("new version:", newVersion);

    await pushChanges(tools, tag);
  } catch (e) {
    tools.log.fatal(e);
    tools.exit.failure("Failed to bump version");
  }
  tools.exit.success("Version bumped!");
});
