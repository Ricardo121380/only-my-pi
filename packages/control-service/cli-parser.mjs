import path from "node:path";

const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const SNAPSHOT_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const SCOPES = new Set(["global", "project"]);

const VALUE_OPTIONS = new Map([
  ["--profile", "profile"],
  ["--mode", "mode"],
  ["--provider", "provider"],
  ["--model", "model"],
  ["--scope", "scope"],
  ["--config-root", "configRoot"],
  ["--input-file", "inputFile"],
  ["--project", "projectRoot"],
]);

const BOOLEAN_OPTIONS = new Map([
  ["--apply", "apply"],
  ["--dry-run", "dryRun"],
  ["--plan", "plan"],
  ["--yes", "yes"],
  ["--json", "json"],
  ["--static", "static"],
  ["--live", "live"],
  ["--resolved", "resolved"],
]);

const COMMANDS = new Set([
  "bootstrap",
  "doctor",
  "status",
  "update",
  "rollback",
  "uninstall",
  "safe",
  "profile",
  "profiles",
  "models",
  "gate",
  "tools",
  "packages",
  "context",
  "verify",
  "mode",
  "workflow",
  "swarm",
  "ultra",
  "theme",
  "help",
]);

const MODE_COMMANDS = new Set(["list", "show", "use", "reset", "doctor", "diff", "scaffold"]);
const PROFILE_COMMANDS = new Set(["list", "show", "diff"]);
const PRESET_COMMANDS = new Set(["list", "show", "plan", "apply"]);
const MODEL_COMMANDS = new Set(["validate"]);
const GATE_COMMANDS = new Set(["validate"]);
const WORKFLOW_COMMANDS = new Set(["list", "show", "run", "status", "cancel", "resume"]);
const SWARM_COMMANDS = new Set(["list", "show", "validate", "plan", "run", "status", "cancel", "resume", "batch", "goal"]);
const BATCH_SWARM_COMMANDS = new Set(["list", "show", "validate", "plan", "run", "status", "cancel", "resume"]);
const GOAL_SWARM_COMMANDS = new Set(["list", "show", "validate", "plan", "run", "status"]);
const ULTRA_COMMANDS = new Set(["list", "show", "validate", "plan", "run"]);
const THEME_COMMANDS = new Set(["list", "show", "preview", "use", "reset", "doctor"]);
const MODE_NAMESPACED_ID = /^(?:[a-z][a-z0-9-]{0,63}(?:\/[a-z][a-z0-9-]{0,63})?|(?:user|project|package):[a-z][a-z0-9-]{0,63})$/u;

function fail(message, code = "INVALID_ARGUMENT") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assertIdentifier(value, label) {
  if (!ID.test(value)) fail(`${label} must be a canonical lowercase identifier`);
}

function assertModeIdentifier(value, label = "mode") {
  if (!MODE_NAMESPACED_ID.test(value)) fail(`${label} must be a canonical mode identifier`);
}

function takeValue(argv, index, option) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("-")) fail(`${option} requires a value`);
  if (value.length > 512) fail(`${option} value is too long`);
  if (/\0|[\r\n]/.test(value)) fail(`${option} contains forbidden control characters`);
  return value;
}

function parseOptions(argv) {
  const options = {};
  const positionals = [];
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") fail("the -- argument separator is not accepted by omp commands");
    if (token.startsWith("--") && token.includes("=")) fail(`inline option assignment is not accepted: ${token}`);
    if (VALUE_OPTIONS.has(token)) {
      if (seen.has(token)) fail(`duplicate option: ${token}`);
      seen.add(token);
      options[VALUE_OPTIONS.get(token)] = takeValue(argv, index, token);
      index += 1;
      continue;
    }
    if (BOOLEAN_OPTIONS.has(token)) {
      if (seen.has(token)) fail(`duplicate option: ${token}`);
      seen.add(token);
      options[BOOLEAN_OPTIONS.get(token)] = true;
      continue;
    }
    if (token.startsWith("-")) fail(`unknown option: ${token}`);
    if (token.length > 512 || /\0|[\r\n]/.test(token)) fail("invalid positional argument");
    positionals.push(token);
  }
  return { options, positionals };
}

function reject(options, names, command) {
  for (const name of names) {
    if (options[name] !== undefined) fail(`--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is not valid for ${command}`);
  }
}

function resolveConfigRoot(value, env, homedir) {
  const selected = value ?? env.PI_CODING_AGENT_DIR ?? path.join(homedir(), ".pi", "agent");
  if (!path.isAbsolute(selected)) fail("config root must be an absolute path", "INVALID_CONFIG_ROOT");
  return path.normalize(selected);
}

export function parseOmpArgs(argv, { env = process.env, homedir = () => process.env.HOME ?? "" } = {}) {
  if (!Array.isArray(argv) || argv.length > 64) fail("too many arguments");
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    return { command: "help", mutation: false, options: { json: false } };
  }
  const command = argv[0];
  if (!COMMANDS.has(command)) fail(`unknown command: ${command}`);
  const { options, positionals } = parseOptions(argv.slice(1));
  const configRoot = resolveConfigRoot(options.configRoot, env, homedir);

  if (!new Set(["swarm", "workflow", "ultra"]).has(command) && options.inputFile !== undefined) fail("--input-file is only valid for workflow, swarm, or ultra commands");
  if (!["models", "gate"].includes(command) && options.projectRoot !== undefined) fail("--project is only valid for models or gate validate");

  if (options.profile !== undefined) assertIdentifier(options.profile, "profile");
  if (options.mode !== undefined) {
    if (command === "bootstrap") assertModeIdentifier(options.mode, "mode");
    else assertIdentifier(options.mode, "mode");
  }
  if (options.provider !== undefined) assertIdentifier(options.provider, "provider");
  if (options.scope !== undefined && !SCOPES.has(options.scope)) fail("scope must be global or project");
  if (options.projectRoot !== undefined && !path.isAbsolute(options.projectRoot)) fail("--project must be an absolute path");
  if (options.model !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$/.test(options.model)) {
    fail("model must be a bounded non-secret identifier");
  }

  if (command === "help") {
    if (positionals.length || Object.keys(options).length) fail("help accepts no options or arguments");
    return { command, mutation: false, options: { json: false } };
  }

  if (command === "bootstrap") {
    if (positionals.length) fail("bootstrap accepts no positional arguments");
    reject(options, ["plan", "static", "live", "resolved"], command);
    if (options.apply && options.dryRun) fail("--apply and --dry-run are mutually exclusive");
    const apply = options.apply === true;
    if (options.yes && !apply) fail("--yes is only valid with --apply");
    return {
      command,
      mutation: apply,
      options: {
        profile: options.profile ?? "coding",
        initialMode: options.mode ?? null,
        provider: options.provider ?? null,
        model: options.model ?? null,
        scope: options.scope ?? "global",
        configRoot,
        apply,
        dryRun: !apply,
        yes: options.yes === true,
        json: options.json === true,
      },
    };
  }

  if (command === "doctor") {
    if (positionals.length) fail("doctor accepts no positional arguments");
    reject(options, ["profile", "mode", "provider", "model", "scope", "apply", "dryRun", "plan", "yes", "resolved"], command);
    if (options.static && options.live) fail("--static and --live are mutually exclusive");
    return { command, mutation: false, options: { configRoot, live: options.live === true, json: options.json === true } };
  }

  if (command === "status") {
    if (positionals.length) fail("status accepts no positional arguments");
    reject(options, ["profile", "mode", "provider", "model", "scope", "apply", "dryRun", "plan", "yes", "static", "live", "resolved"], command);
    return { command, mutation: false, options: { configRoot, json: options.json === true } };
  }

  if (command === "update" || command === "uninstall") {
    if (positionals.length) fail(`${command} accepts no positional arguments`);
    reject(options, ["profile", "mode", "provider", "model", "scope", "dryRun", "static", "live", "resolved"], command);
    if (options.apply && options.plan) fail("--apply and --plan are mutually exclusive");
    const apply = options.apply === true;
    if (options.yes && !apply) fail("--yes is only valid with --apply");
    return { command, mutation: apply, options: { configRoot, apply, plan: !apply, yes: options.yes === true, json: options.json === true } };
  }

  if (command === "rollback") {
    reject(options, ["profile", "mode", "provider", "model", "scope", "apply", "dryRun", "plan", "static", "live", "resolved"], command);
    if (positionals.length > 1) fail("rollback accepts at most one snapshot id");
    const snapshotId = positionals[0] ?? null;
    if (snapshotId !== null && !SNAPSHOT_ID.test(snapshotId)) fail("invalid snapshot id");
    return { command, mutation: true, options: { configRoot, snapshotId, yes: options.yes === true, json: options.json === true } };
  }

  if (command === "safe") {
    if (positionals.length) fail("safe accepts no positional arguments");
    reject(options, ["profile", "mode", "provider", "model", "scope", "apply", "dryRun", "plan", "yes", "static", "live", "resolved"], command);
    return { command, mutation: false, options: { configRoot, json: options.json === true } };
  }

  if (command === "profile") {
    reject(options, ["profile", "mode", "provider", "model", "scope", "apply", "dryRun", "plan", "yes", "static", "live", "resolved", "projectRoot"], command);
    const subcommand = positionals[0] ?? "list";
    if (!PROFILE_COMMANDS.has(subcommand)) fail(`unknown profile subcommand: ${subcommand}`);
    if (subcommand === "list" && positionals.length !== 1) fail("profile list accepts no profile id");
    if (subcommand === "show" && positionals.length !== 2) fail("profile show requires a profile id");
    if (subcommand === "diff" && positionals.length !== 3) fail("profile diff requires from and to profile ids");
    const ids = positionals.slice(1);
    for (const id of ids) assertIdentifier(id, "profile id");
    return {
      command,
      mutation: false,
      options: {
        configRoot,
        subcommand,
        profileId: ids[0] ?? null,
        toProfileId: ids[1] ?? null,
        json: options.json === true,
      },
    };
  }

  if (command === "profiles") {
    reject(options, ["profile", "mode", "provider", "model", "scope", "apply", "dryRun", "plan", "static", "live", "resolved", "projectRoot"], command);
    const subcommand = positionals[0] ?? "list";
    if (!PRESET_COMMANDS.has(subcommand)) fail(`unknown profiles subcommand: ${subcommand}`);
    const presetId = positionals[1] ?? null;
    if (subcommand === "list" && positionals.length !== 1) fail("profiles list accepts no preset id");
    if (["show", "plan", "apply"].includes(subcommand) && positionals.length !== 2) fail(`profiles ${subcommand} requires one preset or overlay id`);
    if (presetId !== null) assertIdentifier(presetId, "preset or overlay id");
    if (options.yes && subcommand !== "apply") fail("--yes is only valid for profiles apply");
    return {
      command,
      mutation: subcommand === "apply",
      options: { configRoot, subcommand, presetId, yes: options.yes === true, json: options.json === true },
    };
  }

  if (command === "models") {
    reject(options, ["profile", "mode", "provider", "model", "scope", "apply", "dryRun", "plan", "yes", "static", "live", "resolved"], command);
    const subcommand = positionals[0] ?? "validate";
    if (!MODEL_COMMANDS.has(subcommand) || positionals.length !== 1) fail("models accepts only the validate subcommand");
    return {
      command,
      mutation: false,
      options: { configRoot, subcommand, projectRoot: options.projectRoot ? path.resolve(options.projectRoot) : null, json: options.json === true },
    };
  }

  if (command === "gate") {
    reject(options, ["profile", "mode", "provider", "model", "scope", "apply", "dryRun", "plan", "yes", "static", "live", "resolved"], command);
    const subcommand = positionals[0] ?? "validate";
    if (!GATE_COMMANDS.has(subcommand) || positionals.length !== 1) fail("gate accepts only the validate subcommand");
    return { command, mutation: false, options: { configRoot, subcommand, projectRoot: options.projectRoot ? path.resolve(options.projectRoot) : null, json: options.json === true } };
  }

  if (["tools", "packages", "context", "verify"].includes(command)) {
    reject(options, ["mode", "profile", "provider", "model", "scope", "apply", "dryRun", "plan", "yes", "static", "live", "resolved"], command);
    if (positionals.length) fail(`${command} accepts no positional arguments`);
    return { command, mutation: false, options: { configRoot, json: options.json === true } };
  }

  if (command === "mode") {
    reject(options, ["provider", "model", "scope", "apply", "dryRun", "plan", "yes", "static", "live"], command);
    if (options.mode !== undefined) fail("mode subcommand takes its mode id as a positional argument");
    const subcommand = positionals[0] ?? "list";
    if (!MODE_COMMANDS.has(subcommand)) fail(`unknown mode subcommand: ${subcommand}`);
    const modeId = positionals[1] ?? null;
    if (positionals.length > 2) fail(`mode ${subcommand} accepts at most one mode id`);
    if (["show", "use", "diff", "scaffold"].includes(subcommand) && modeId === null) {
      fail(`mode ${subcommand} requires a mode id`);
    }
    if (modeId !== null) assertModeIdentifier(modeId, "mode id");
    if (subcommand === "list" && modeId !== null) fail("mode list accepts no mode id");
    if (subcommand === "doctor" && modeId !== null) fail("mode doctor accepts no mode id");
    return {
      command,
      mutation: false,
      options: {
        configRoot,
        profile: options.profile ?? null,
        subcommand,
        modeId,
        resolved: options.resolved === true,
        json: options.json === true,
      },
    };
  }

  if (command === "workflow") {
    reject(options, ["provider", "model", "scope", "dryRun", "plan", "static", "live", "resolved"], command);
    const subcommand = positionals[0] ?? "list";
    if (!WORKFLOW_COMMANDS.has(subcommand)) fail(`unknown workflow subcommand: ${subcommand}`);
    const workflowId = positionals[1] ?? null;
    if (["show", "run", "status", "cancel", "resume"].includes(subcommand) && workflowId === null) fail(`workflow ${subcommand} requires an id`);
    if (positionals.length > 2) fail(`workflow ${subcommand} accepts at most one id`);
    if (workflowId !== null) assertIdentifier(workflowId, "workflow id");
    if (options.inputFile !== undefined) {
      if (!["run", "resume"].includes(subcommand)) fail("--input-file is only valid for workflow run or resume");
      if (!path.isAbsolute(options.inputFile)) fail("--input-file must be an absolute path");
    }
    const apply = options.apply === true;
    if (options.yes && !apply) fail("--yes is only valid with --apply");
    if (subcommand !== "run" && (apply || options.yes)) fail(`--apply/--yes are only valid for workflow run`);
    return {
      command,
      // Resume is a state-changing operation even though it does not accept
      // the install-time --apply flag.  The coordinator still requires the
      // original input/approval evidence and will fail closed when either is
      // unavailable; the parser must not mislabel it as read-only.
      mutation: ["cancel", "resume"].includes(subcommand) || (subcommand === "run" && apply),
      options: {
        configRoot,
        subcommand,
        workflowId,
        runId: ["status", "cancel", "resume"].includes(subcommand) ? workflowId : null,
        profile: options.profile ?? null,
        inputFile: options.inputFile ?? null,
        apply,
        yes: options.yes === true,
        json: options.json === true,
      },
    };
  }

  if (command === "swarm") {
    reject(options, ["mode", "provider", "model", "scope", "apply", "dryRun", "plan", "static", "live", "resolved"], command);
    const subcommand = positionals[0] ?? "list";
    if (!SWARM_COMMANDS.has(subcommand)) fail(`unknown swarm subcommand: ${subcommand}`);
    if (subcommand === "batch") {
      const batchSubcommand = positionals[1] ?? "list";
      if (!BATCH_SWARM_COMMANDS.has(batchSubcommand)) fail(`unknown swarm batch subcommand: ${batchSubcommand}`);
      const identifier = positionals[2] ?? null;
      if (["show", "validate", "plan", "run"].includes(batchSubcommand) && identifier === null) fail(`swarm batch ${batchSubcommand} requires a batch id`);
      if (["status", "cancel", "resume"].includes(batchSubcommand) && identifier === null) fail(`swarm batch ${batchSubcommand} requires a run id`);
      if (positionals.length > 3) fail(`swarm batch ${batchSubcommand} accepts at most one id`);
      if (identifier !== null) assertIdentifier(identifier, ["status", "cancel", "resume"].includes(batchSubcommand) ? "run id" : "batch id");
      if (options.inputFile !== undefined) {
        if (!["plan", "run", "resume"].includes(batchSubcommand)) fail("--input-file is only valid for swarm batch plan, run, or resume");
        if (!path.isAbsolute(options.inputFile)) fail("--input-file must be an absolute path");
      }
      if (options.yes && batchSubcommand !== "run") fail("--yes is only valid for swarm batch run");
      return {
        command,
        mutation: ["run", "cancel", "resume"].includes(batchSubcommand),
        options: {
          configRoot,
          subcommand: "batch",
          batchSubcommand,
          batchId: ["status", "cancel", "resume"].includes(batchSubcommand) ? null : identifier,
          runId: ["status", "cancel", "resume"].includes(batchSubcommand) ? identifier : null,
          inputFile: options.inputFile ?? null,
          yes: options.yes === true,
          json: options.json === true,
        },
      };
    }
    if (subcommand === "goal") {
      const goalSubcommand = positionals[1] ?? "list";
      if (!GOAL_SWARM_COMMANDS.has(goalSubcommand)) fail(`unknown swarm goal subcommand: ${goalSubcommand}`);
      const identifier = positionals[2] ?? null;
      if (["show", "validate", "plan", "run"].includes(goalSubcommand) && identifier === null) fail(`swarm goal ${goalSubcommand} requires a goal id`);
      if (goalSubcommand === "status" && identifier === null) fail("swarm goal status requires a run id");
      if (positionals.length > 3) fail(`swarm goal ${goalSubcommand} accepts at most one id`);
      if (identifier !== null) assertIdentifier(identifier, goalSubcommand === "status" ? "run id" : "goal id");
      if (options.inputFile !== undefined) {
        if (!["plan", "run"].includes(goalSubcommand)) fail("--input-file is only valid for swarm goal plan or run");
        if (!path.isAbsolute(options.inputFile)) fail("--input-file must be an absolute path");
      }
      if (options.yes && goalSubcommand !== "run") fail("--yes is only valid for swarm goal run");
      return {
        command,
        mutation: goalSubcommand === "run",
        options: {
          configRoot,
          subcommand: "goal",
          goalSubcommand,
          goalId: goalSubcommand === "status" ? null : identifier,
          runId: goalSubcommand === "status" ? identifier : null,
          inputFile: options.inputFile ?? null,
          yes: options.yes === true,
          json: options.json === true,
        },
      };
    }
    const recipeId = positionals[1] ?? null;
    if (["show", "validate", "plan", "run"].includes(subcommand) && recipeId === null) fail(`swarm ${subcommand} requires a recipe id`);
    if (["status", "cancel", "resume"].includes(subcommand) && recipeId === null) fail(`swarm ${subcommand} requires a run id`);
    if (positionals.length > 2) fail(`swarm ${subcommand} accepts at most one id`);
    if (recipeId !== null) assertIdentifier(recipeId, ["status", "cancel", "resume"].includes(subcommand) ? "run id" : "recipe id");
    if (options.inputFile !== undefined && !path.isAbsolute(options.inputFile)) fail("--input-file must be an absolute path");
    if (options.yes && subcommand !== "run") fail("--yes is only valid for swarm run");
    return {
      command,
      // A resume can append RunResumed/child/terminal events, so expose it as
      // a mutation to callers that enforce confirmation and audit boundaries.
      mutation: ["cancel", "resume"].includes(subcommand) || subcommand === "run",
      options: {
        configRoot,
        subcommand,
        recipeId: ["status", "cancel", "resume"].includes(subcommand) ? null : recipeId,
        runId: ["status", "cancel", "resume"].includes(subcommand) ? recipeId : null,
        inputFile: options.inputFile ?? null,
        yes: options.yes === true,
        json: options.json === true,
      },
    };
  }

  if (command === "ultra") {
    reject(options, ["mode", "profile", "provider", "model", "scope", "apply", "dryRun", "plan", "static", "live", "resolved"], command);
    const subcommand = positionals[0] ?? "list";
    if (!ULTRA_COMMANDS.has(subcommand)) fail(`unknown ultra subcommand: ${subcommand}`);
    const strategyId = positionals[1] ?? null;
    if (["show", "validate", "plan", "run"].includes(subcommand) && strategyId === null) fail(`ultra ${subcommand} requires a strategy id`);
    if (positionals.length > 2) fail(`ultra ${subcommand} accepts at most one strategy id`);
    if (strategyId !== null) assertIdentifier(strategyId, "UltraRun strategy id");
    if (options.inputFile !== undefined) {
      if (!["plan", "run"].includes(subcommand)) fail("--input-file is only valid for ultra plan or run");
      if (!path.isAbsolute(options.inputFile)) fail("--input-file must be an absolute path");
    }
    if (options.yes && subcommand !== "run") fail("--yes is only valid for ultra run");
    return { command, mutation: subcommand === "run", options: { configRoot, subcommand, strategyId, inputFile: options.inputFile ?? null, yes: options.yes === true, json: options.json === true } };
  }

  if (command === "theme") {
    reject(options, ["profile", "mode", "provider", "model", "scope", "dryRun", "static", "live", "resolved", "plan"], command);
    const subcommand = positionals[0] ?? "list";
    if (!THEME_COMMANDS.has(subcommand)) fail(`unknown theme subcommand: ${subcommand}`);
    const themeId = positionals[1] ?? null;
    if (positionals.length > 2) fail(`theme ${subcommand} accepts at most one theme id`);
    if (["show", "preview", "use"].includes(subcommand) && themeId === null) fail(`theme ${subcommand} requires a theme id`);
    if (["list", "doctor", "reset"].includes(subcommand) && themeId !== null) fail(`theme ${subcommand} accepts no theme id`);
    if (themeId !== null) assertIdentifier(themeId, "theme id");
    const apply = options.apply === true;
    if (options.yes && !apply) fail("--yes is only valid with --apply");
    if (!["use", "reset"].includes(subcommand) && (apply || options.yes)) fail(`--apply/--yes are only valid for theme use or reset`);
    return {
      command,
      mutation: ["use", "reset"].includes(subcommand) && apply,
      options: {
        configRoot,
        subcommand,
        themeId,
        apply,
        yes: options.yes === true,
        json: options.json === true,
      },
    };
  }

  fail(`unsupported command: ${command}`);
}

export const ompCommands = Object.freeze([...COMMANDS]);
