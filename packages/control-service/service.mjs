export const OMP_USAGE = `only-my-pi control CLI

Usage:
  omp bootstrap [--profile <id>] [--mode <id>] [--provider <id>] [--model <id>] [--scope global|project] [--config-root <absolute>] [--dry-run|--apply] [--yes] [--json]
  omp doctor [--static|--live] [--config-root <absolute>] [--json]
  omp status [--config-root <absolute>] [--json]
  omp update [--plan|--apply] [--yes] [--config-root <absolute>] [--json]
  omp rollback [snapshot-id] [--yes] [--config-root <absolute>] [--json]
  omp uninstall [--plan|--apply] [--yes] [--config-root <absolute>] [--json]
  omp safe [--config-root <absolute>] [--json]

Mutation is never implicit. bootstrap, update, and uninstall default to a zero-write plan.
Provider/model flags save metadata only and remain CONFIGURED_UNVERIFIED.`;

function confirmationRequired(command, plan) {
  return {
    ok: false,
    status: "CONFIRMATION_REQUIRED",
    command,
    mutation: true,
    plan,
  };
}

async function approve(request, plan, confirm) {
  if (request.options.yes) return true;
  if (typeof confirm !== "function") return false;
  return (await confirm({ command: request.command, plan })) === true;
}

export class ControlService {
  constructor({ bootstrap, doctor, confirm } = {}) {
    if (!bootstrap || !doctor) throw new TypeError("bootstrap and doctor services are required");
    this.bootstrap = bootstrap;
    this.doctor = doctor;
    this.confirm = confirm;
  }

  async dispatch(request) {
    switch (request.command) {
      case "help":
        return { ok: true, status: "HELP", mutation: false, text: OMP_USAGE };
      case "bootstrap": {
        const plan = await this.bootstrap.planBootstrap(request.options);
        if (!request.options.apply) return plan;
        if (!(await approve(request, plan, this.confirm))) return confirmationRequired(request.command, plan);
        return this.bootstrap.applyBootstrap({ ...request.options, plan });
      }
      case "update": {
        const plan = await this.bootstrap.planUpdate(request.options);
        if (!request.options.apply) return plan;
        if (!(await approve(request, plan, this.confirm))) return confirmationRequired(request.command, plan);
        return this.bootstrap.applyUpdate({ ...request.options, plan });
      }
      case "uninstall": {
        const plan = await this.bootstrap.planUninstall(request.options);
        if (!request.options.apply) return plan;
        if (!(await approve(request, plan, this.confirm))) return confirmationRequired(request.command, plan);
        return this.bootstrap.applyUninstall({ ...request.options, plan });
      }
      case "rollback": {
        const plan = await this.bootstrap.planRollback(request.options);
        if (!(await approve(request, plan, this.confirm))) return confirmationRequired(request.command, plan);
        return this.bootstrap.rollback({ ...request.options, plan });
      }
      case "doctor":
        return request.options.live ? this.doctor.live(request.options) : this.bootstrap.doctor(request.options);
      case "status":
        return this.bootstrap.status(request.options);
      case "safe":
        return this.bootstrap.safe(request.options);
      default:
        throw Object.assign(new Error(`unsupported control command: ${request.command}`), { code: "UNSUPPORTED_COMMAND" });
    }
  }
}

export function createControlService(options) {
  return new ControlService(options);
}
