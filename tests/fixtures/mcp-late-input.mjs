import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

// Delay one real, public agent_end hook until the actual TUI has queued another
// input. Pi still dispatches every event and performs the real continuation;
// this observes public AgentSession getters and never fabricates an event.
export async function installMcpLateInputGate(f) {
  const original = path.join(path.dirname(f.sdk), "index-without-input-gate.js"), trace = path.join(f.root, "late-input.jsonl");
  const sdkOriginalSha256 = createHash("sha256").update(await fs.readFile(f.sdk)).digest("hex");
  await fs.rename(f.sdk, original);
  await fs.writeFile(f.sdk, `export * from "./index-without-input-gate.js";
import {createAgentSessionServices as realServices,createAgentSessionFromServices as realSession} from "./index-without-input-gate.js";
import fs from "node:fs/promises";
let session, gated=false;
const record=async stage=>fs.appendFile(${JSON.stringify(trace)},JSON.stringify({stage,isStreaming:session?.isStreaming,queued:session?.getSteeringMessages().length,at:Date.now()})+"\\n");
function observe(pi){
 pi.on("before_agent_start",()=>record("before_agent_start"));
 pi.on("agent_end",async(_event,ctx)=>{
  if(ctx.mode!=="tui"||gated)return;
  gated=true;await record("agent_end_gate");
  const deadline=Date.now()+5000;
  while(!session.getSteeringMessages().length&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
  if(!session.getSteeringMessages().length)throw new Error("CONTROLLED_LATE_INPUT_NOT_QUEUED");
  await record("queued_input");
 });
 pi.on("agent_settled",()=>record("agent_settled"));
}
export async function createAgentSessionServices(options){
 return realServices({...options,resourceLoaderOptions:{...options.resourceLoaderOptions,extensionFactories:[...(options.resourceLoaderOptions?.extensionFactories??[]),observe]}});
}
export async function createAgentSessionFromServices(options){const value=await realSession(options);session=value.session;return value;}
`);
  return { trace, sdkOriginalSha256, read: async () => (await fs.readFile(trace, "utf8").catch(error => { if (error.code === "ENOENT") return ""; throw error; })).trim().split("\n").filter(Boolean).map(JSON.parse) };
}
