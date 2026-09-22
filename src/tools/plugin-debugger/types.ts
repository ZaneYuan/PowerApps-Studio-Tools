export interface ProfilerEnvironment {
  /** Local Plugin Registration Tool `tools` folder the Profiler libraries load from; null when not found. */
  prtDirectory: string | null;
  hostAvailable: boolean;
}

export interface StepCandidate {
  stepId: string;
  name: string;
  stage: number;
  mode: number;
  enabled: boolean;
  typeName: string;
}

/** A "(Profiler)" step that currently stands in for a disabled original step. */
export interface ProfilingStep {
  profilerStepId: string;
  name: string;
  createdOn: string;
}

export interface ProfileSummary {
  profileId: string;
  typeName: string;
  messageName: string;
  primaryEntity: string;
  depth: number | null;
  executionDurationMs: number | null;
  createdOn: string;
}

/** SDK values as flattened by ProfilerHost's ReportJson: Entity / EntityReference /
 *  OptionSetValue / Money / EntityCollection carry a `$type`; primitives are plain JSON. */
export type SdkValue = null | string | number | boolean | SdkValue[] | { $type: string; [key: string]: unknown };

export interface ExecutionContext {
  messageName: string;
  stage: number;
  mode: number;
  depth: number;
  primaryEntityName: string;
  primaryEntityId: string;
  secondaryEntityName: string;
  userId: string;
  initiatingUserId: string;
  businessUnitId: string;
  organizationName: string;
  correlationId: string;
  requestId: string | null;
  operationCreatedOn: string;
  isInTransaction: boolean;
  isolationMode: number;
  inputParameters: Record<string, SdkValue>;
  outputParameters: Record<string, SdkValue>;
  sharedVariables: Record<string, SdkValue>;
  preEntityImages: Record<string, SdkValue>;
  postEntityImages: Record<string, SdkValue>;
  parentContext?: ExecutionContext;
}

export interface DecodedProfile {
  typeName: string;
  operationType: string;
  contextFormat: string;
  isolationMode: number | null;
  executionStartTime: string | null;
  executionDurationMs: number | null;
  constructorException: string | null;
  executionException: string | null;
  replayEventCount: number;
  unsecureConfiguration: string | null;
  context?: ExecutionContext;
  /** Present instead of `context` for workflow-activity or ProtoBuf-format profiles. */
  rawContext?: string;
}

export interface ReplayResult {
  typeName: string;
  durationMs: number;
  fault: string | null;
  traces: string[];
  organizationServiceCalls: number;
}
