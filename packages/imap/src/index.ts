export {
  parseCommand,
  parseSequenceSet,
  parseFetchItems,
  parseSearchCriteria,
  ImapParseError,
} from "./protocol/parser.ts";
export {
  formatTagged,
  formatUntagged,
  formatContinuation,
  formatCapability,
  formatListResponse,
  formatStatusResponse,
  formatFetchResponse,
  formatSearchResponse,
  formatSelectResponse,
  formatExpungeResponse,
  formatExistsResponse,
  formatGreeting,
  formatBye,
} from "./protocol/formatter.ts";
export type {
  ParsedCommand,
  SequenceRange,
  SequenceSet,
  FetchItem,
  SearchCriterion,
} from "./protocol/parser.ts";
export type { FetchResponseData, EnvelopeData, AddressData } from "./protocol/formatter.ts";
export { ImapSession } from "./session.ts";
export type { SessionState, SelectedFolderInfo } from "./session.ts";
export { UidMap } from "./uid-map.ts";
export {
  imapFlagsToMailFields,
  mailFieldsToImapFlags,
  applyFlagUpdate,
  SUPPORTED_FLAGS,
  PERMANENT_FLAGS,
} from "./flags.ts";
export type { MessageFlagFields } from "./flags.ts";
