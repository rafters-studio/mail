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
export {
  handleCapability,
  handleLogin,
  handleLogout,
  generateGreeting,
  SERVER_CAPABILITIES,
} from "./commands/auth.ts";
export type { AuthAdapter } from "./commands/auth.ts";
export {
  handleSelect,
  handleExamine,
  handleList,
  handleLsub,
  handleStatus,
} from "./commands/mailbox.ts";
export type { MailboxAdapter, FolderInfo, FolderStats } from "./commands/mailbox.ts";
export {
  handleFetch,
  handleStore,
  handleSearch,
  handleExpunge,
  handleNoop,
  handleClose,
} from "./commands/message.ts";
export type { MessageAdapter, MessageData } from "./commands/message.ts";
export {
  handleIdleStart,
  handleIdleDone,
  isIdleDone,
  handleIdleBadInput,
  generateIdleNotification,
} from "./commands/session.ts";
export type { IdleState } from "./commands/session.ts";
export { handleCopy, handleMove, handleAppend, handleUnselect } from "./commands/extensions.ts";
export type { ExtensionAdapter } from "./commands/extensions.ts";
