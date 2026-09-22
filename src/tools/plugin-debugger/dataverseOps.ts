import { callNative } from "../../native/bridge";
import { escapeODataString } from "../../native/odata";
import type { DecodedProfile, ProfilerEnvironment, ProfileSummary, ProfilingStep, ReplayResult, StepCandidate } from "./types";

/** Unique name of Microsoft's Plug-in Profiler solution (from its solution.xml). */
const PROFILER_SOLUTION = "PluginProfiler";
/** Plug-in type every "(Profiler)" step points at while a step is being profiled. */
const PROFILER_PLUGIN_TYPE = "PluginProfiler.Plugins.ProfilerPlugin";
const STEP_SEARCH_LIMIT = 100;

// Solution import alone took ~4 minutes on a real org; the others run one or two SDK calls.
const INSTALL_TIMEOUT_MS = 15 * 60_000;
const STEP_TIMEOUT_MS = 3 * 60_000;
// Replay can sit in the JIT-debugger prompt and then at breakpoints for as long as the developer needs.
const REPLAY_TIMEOUT_MS = 60 * 60_000;

async function get<T>(connectionId: string, path: string): Promise<T> {
  return callNative<T>("dataverse.request", { connectionId, method: "GET", path });
}

export function fetchProfilerEnvironment(): Promise<ProfilerEnvironment> {
  return callNative<ProfilerEnvironment>("profiler.environment", {});
}

export async function isProfilerInstalled(connectionId: string): Promise<boolean> {
  const res = await get<{ value: unknown[] }>(connectionId, `solutions?$select=solutionid&$filter=uniquename eq '${PROFILER_SOLUTION}'`);
  return res.value.length > 0;
}

export async function installProfiler(connectionId: string): Promise<void> {
  await callNative("profiler.install", { connectionId }, { timeoutMs: INSTALL_TIMEOUT_MS });
}

export async function uninstallProfiler(connectionId: string): Promise<void> {
  await callNative("profiler.uninstall", { connectionId }, { timeoutMs: INSTALL_TIMEOUT_MS });
}

interface RawStep {
  sdkmessageprocessingstepid: string;
  name: string;
  stage: number;
  mode: number;
  statecode: number;
  eventhandler_plugintype: { typename: string } | null;
}

/** Custom plug-in steps only: the Profiler rejects Microsoft's own (non-custom) plug-ins. */
export async function searchCustomSteps(connectionId: string, search: string): Promise<StepCandidate[]> {
  const res = await get<{ value: RawStep[] }>(
    connectionId,
    "sdkmessageprocessingsteps?$select=sdkmessageprocessingstepid,name,stage,mode,statecode" +
      "&$expand=eventhandler_plugintype($select=typename)" +
      `&$filter=customizationlevel eq 1 and contains(name,'${escapeODataString(search)}')&$orderby=name&$top=${STEP_SEARCH_LIMIT}`,
  );
  return res.value
    .filter((s) => s.eventhandler_plugintype && s.eventhandler_plugintype.typename !== PROFILER_PLUGIN_TYPE)
    .map((s) => ({
      stepId: s.sdkmessageprocessingstepid,
      name: s.name,
      stage: s.stage,
      mode: s.mode,
      enabled: s.statecode === 0,
      typeName: s.eventhandler_plugintype?.typename ?? "",
    }));
}

export async function fetchProfilingSteps(connectionId: string): Promise<ProfilingStep[]> {
  const res = await get<{ value: { sdkmessageprocessingstepid: string; name: string; createdon: string }[] }>(
    connectionId,
    "sdkmessageprocessingsteps?$select=sdkmessageprocessingstepid,name,createdon" +
      `&$filter=eventhandler_plugintype/typename eq '${PROFILER_PLUGIN_TYPE}'&$orderby=createdon desc`,
  );
  return res.value.map((s) => ({ profilerStepId: s.sdkmessageprocessingstepid, name: s.name, createdOn: s.createdon }));
}

export async function startProfiling(connectionId: string, stepId: string): Promise<void> {
  await callNative("profiler.enable", { connectionId, stepId }, { timeoutMs: STEP_TIMEOUT_MS });
}

export async function stopProfiling(connectionId: string, profilerStepId: string): Promise<void> {
  await callNative("profiler.disable", { connectionId, profilerStepId }, { timeoutMs: STEP_TIMEOUT_MS });
}

interface RawProfile {
  mbs_pluginprofileid: string;
  mbs_typename: string | null;
  mbs_messagename: string | null;
  mbs_primaryentity: string | null;
  mbs_depth: number | null;
  mbs_performanceexecutionduration: number | null;
  createdon: string;
}

export async function fetchProfiles(connectionId: string): Promise<ProfileSummary[]> {
  const res = await get<{ value: RawProfile[] }>(
    connectionId,
    "mbs_pluginprofiles?$select=mbs_pluginprofileid,mbs_typename,mbs_messagename,mbs_primaryentity,mbs_depth,mbs_performanceexecutionduration,createdon" +
      "&$orderby=createdon desc&$top=100",
  );
  return res.value.map((p) => ({
    profileId: p.mbs_pluginprofileid,
    typeName: p.mbs_typename ?? "",
    messageName: p.mbs_messagename ?? "",
    primaryEntity: p.mbs_primaryentity ?? "",
    depth: p.mbs_depth,
    executionDurationMs: p.mbs_performanceexecutionduration,
    createdOn: p.createdon,
  }));
}

export async function fetchProfileContent(connectionId: string, profileId: string): Promise<string> {
  const res = await get<{ mbs_profile: string | null }>(connectionId, `mbs_pluginprofiles(${profileId})?$select=mbs_profile`);
  if (!res.mbs_profile) throw new Error("这条抓取记录没有内容。");
  return res.mbs_profile;
}

export async function deleteProfile(connectionId: string, profileId: string): Promise<void> {
  await callNative("dataverse.request", { connectionId, method: "DELETE", path: `mbs_pluginprofiles(${profileId})` });
}

export function decodeProfile(profile: string): Promise<DecodedProfile> {
  return callNative<DecodedProfile>("profiler.decode", { profile }, { timeoutMs: STEP_TIMEOUT_MS });
}

export function replayProfile(input: { profile: string; assemblyPath: string; typeName: string; launchDebugger: boolean }): Promise<ReplayResult> {
  return callNative<ReplayResult>("profiler.replay", input, { timeoutMs: REPLAY_TIMEOUT_MS });
}

export function pickPluginAssembly(): Promise<{ filePath: string | null }> {
  return callNative("dialog.pickFile", { title: "选择本地编译的插件程序集 (.dll)" });
}
