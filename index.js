const { Toolkit } = require("actions-toolkit");
const { execSync } = require("child_process");

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

const checkIsVersionBump = (messages, commitMessage) =>
  messages.map((message) => message.toLowerCase().includes(commitMessage)).includes(true);

const getCommitMessages = (commits) => commits.map((commit) => commit.message + "\n" + commit.body);

const setGitConfig = async (tools) => {
  await tools.runInWorkspace("git", [
    "config",
    "user.name",
    `"${process.env.GITHUB_USER || "Automated Version Bump"}"`,
  ]);
  await tools.runInWorkspace("git", ["config", "user.email", process.env.GITHUB_EMAIL]);
};

// Change working directory if user defined PACKAGEJSON_DIR
// if (process.env.PACKAGEJSON_DIR) {
//   process.env.GITHUB_WORKSPACE = `${process.env.GITHUB_WORKSPACE}/${process.env.PACKAGEJSON_DIR}`;
//   process.chdir(process.env.GITHUB_WORKSPACE);
// }

// Run your GitHub Action!
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
    await tools.runInWorkspace("npm", ["version", "--allow-same-version=true", "--git-tag-version=false", current]);
    console.log("current:", current, "/", "version:", version);
    let newVersion = execSync(`npm version --git-tag-version=false ${version}`).toString().trim();
    await tools.runInWorkspace("git", ["commit", "-a", "-m", `ci: ${commitMessage} ${newVersion}`]);

    // now go to the actual branch to perform the same versioning
    await tools.runInWorkspace("git", ["checkout", currentBranch]);
    await tools.runInWorkspace("npm", ["version", "--allow-same-version=true", "--git-tag-version=false", current]);
    console.log("current:", current, "/", "version:", version);
    newVersion = execSync(`npm version --git-tag-version=false ${version}`).toString().trim();
    newVersion = `${process.env["INPUT_TAG-PREFIX"]}${newVersion}`;

    if (process.env["INPUT_SUB-PACKAGE"]) {
      console.log("Change sub package started");
      tools.runInWorkspace("cd", [process.env["INPUT_SUB-PACKAGE"]]);
      execSync(`npm version --git-tag-version=false ${version}`).toString().trim();
      tools.runInWorkspace("cd", [".."]);
    }

    console.log("new version:", newVersion);
    const remoteRepo = `https://${process.env.GITHUB_ACTOR}:${process.env.GITHUB_TOKEN}@github.com/${process.env.GITHUB_REPOSITORY}.git`;
    // console.log(Buffer.from(remoteRepo).toString('base64'))
    // await tools.runInWorkspace("git", ["tag", newVersion]);
    // await tools.runInWorkspace("git", ["push", remoteRepo, "--follow-tags"]);
    // await tools.runInWorkspace("git", ["push", remoteRepo, "--tags"]);
    await tools.runInWorkspace("git", ["push", remoteRepo]);
  } catch (e) {
    tools.log.fatal(e);
    tools.exit.failure("Failed to bump version");
  }
  tools.exit.success("Version bumped!");
});
