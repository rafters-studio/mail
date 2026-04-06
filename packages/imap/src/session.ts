/**
 * IMAP session state machine per RFC 3501 Section 3.
 *
 * Four states: not-authenticated, authenticated, selected, logout.
 * Commands are only valid in specific states. The session enforces
 * these preconditions.
 */

import { z } from "zod";

export const sessionStateSchema = z.enum([
  "not-authenticated",
  "authenticated",
  "selected",
  "logout",
]);

export type SessionState = z.infer<typeof sessionStateSchema>;

/**
 * RFC 3501 Section 6 defines which commands are valid in which states.
 * This maps each command to the minimum required state.
 */
const COMMAND_REQUIREMENTS: Record<string, SessionState> = {
  // Valid in any state (Section 6.1)
  CAPABILITY: "not-authenticated",
  NOOP: "not-authenticated",
  LOGOUT: "not-authenticated",

  // Valid in not-authenticated state (Section 6.2)
  STARTTLS: "not-authenticated",
  LOGIN: "not-authenticated",
  AUTHENTICATE: "not-authenticated",

  // Valid in authenticated state (Section 6.3)
  SELECT: "authenticated",
  EXAMINE: "authenticated",
  CREATE: "authenticated",
  DELETE: "authenticated",
  RENAME: "authenticated",
  SUBSCRIBE: "authenticated",
  UNSUBSCRIBE: "authenticated",
  LIST: "authenticated",
  LSUB: "authenticated",
  STATUS: "authenticated",
  APPEND: "authenticated",

  // Valid in selected state (Section 6.4)
  CHECK: "selected",
  CLOSE: "selected",
  UNSELECT: "selected",
  EXPUNGE: "selected",
  SEARCH: "selected",
  FETCH: "selected",
  STORE: "selected",
  COPY: "selected",
  MOVE: "selected",
  UID: "selected",
  IDLE: "selected",
};

/**
 * State ordering for permission checks.
 * Higher index means more permissive -- a command requiring
 * "authenticated" is also valid in "selected" state.
 */
const STATE_ORDER: Record<SessionState, number> = {
  "not-authenticated": 0,
  authenticated: 1,
  selected: 2,
  logout: 3,
};

export interface SelectedFolderInfo {
  folderId: string;
  folderName: string;
  uidValidity: number;
  uidNext: number;
  isReadOnly: boolean;
}

export class ImapSession {
  private _state: SessionState = "not-authenticated";
  private _selectedFolder: SelectedFolderInfo | null = null;
  private _loginAttempts = 0;

  static readonly MAX_LOGIN_ATTEMPTS = 3;

  get state(): SessionState {
    return this._state;
  }

  get selectedFolder(): SelectedFolderInfo | null {
    return this._selectedFolder;
  }

  get loginAttempts(): number {
    return this._loginAttempts;
  }

  /**
   * RFC 3501 Section 3: Check if a command is valid in the current state.
   * Returns null if valid, or an error message if not.
   */
  validateCommand(command: string): string | null {
    if (this._state === "logout") {
      return "Session is in logout state";
    }

    const requirement = COMMAND_REQUIREMENTS[command];
    if (requirement === undefined) {
      return `Unknown command: ${command}`;
    }

    const currentOrder = STATE_ORDER[this._state];
    const requiredOrder = STATE_ORDER[requirement];

    // Commands valid in earlier states are also valid in later states,
    // except LOGIN/AUTHENTICATE which are only valid in not-authenticated
    if (command === "LOGIN" || command === "AUTHENTICATE" || command === "STARTTLS") {
      if (this._state !== "not-authenticated") {
        return "Already authenticated";
      }
      return null;
    }

    if (currentOrder < requiredOrder) {
      return `Command ${command} requires ${requirement} state, current state is ${this._state}`;
    }

    return null;
  }

  /**
   * RFC 3501 Section 6.2.3: Transition to authenticated after LOGIN.
   */
  authenticate(): void {
    if (this._state !== "not-authenticated") {
      throw new Error("Cannot authenticate: not in not-authenticated state");
    }
    this._state = "authenticated";
  }

  /**
   * Record a failed login attempt. Returns true if max attempts exceeded.
   */
  recordFailedLogin(): boolean {
    this._loginAttempts++;
    return this._loginAttempts >= ImapSession.MAX_LOGIN_ATTEMPTS;
  }

  /**
   * RFC 3501 Section 6.3.1: Transition to selected after SELECT.
   */
  select(folder: SelectedFolderInfo): void {
    if (this._state !== "authenticated" && this._state !== "selected") {
      throw new Error("Cannot select: not in authenticated or selected state");
    }
    this._selectedFolder = folder;
    this._state = "selected";
  }

  /**
   * RFC 3501 Section 6.3.2: Transition to selected (read-only) after EXAMINE.
   */
  examine(folder: SelectedFolderInfo): void {
    this.select({ ...folder, isReadOnly: true });
  }

  /**
   * RFC 3501 Section 6.4.2: CLOSE returns to authenticated state.
   */
  close(): void {
    if (this._state !== "selected") {
      throw new Error("Cannot close: not in selected state");
    }
    this._selectedFolder = null;
    this._state = "authenticated";
  }

  /**
   * RFC 3501 Section 6.1.3: LOGOUT transitions to logout state.
   */
  logout(): void {
    this._selectedFolder = null;
    this._state = "logout";
  }

  /**
   * Check if the current folder is read-only (EXAMINE vs SELECT).
   * Write commands (STORE, EXPUNGE) should be rejected for read-only folders.
   */
  isReadOnly(): boolean {
    return this._selectedFolder?.isReadOnly ?? false;
  }
}
