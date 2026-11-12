# Generated from legion requirement NFR-MAIL-001, revision 2026-11-07T04:46:19.901182+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: Each part loads alone

  @criterion-NFR-MAIL-001-c1
  Scenario: The address part bundled alone includes nothing of another part
    Given src/address/index.ts
    When esbuild bundles it alone as ESM for a neutral platform, with zod external
    Then its inputs include it, and every input is under src/address/ or src/encoding/

  @criterion-NFR-MAIL-001-c2
  Scenario: The message-id part bundled alone includes nothing of another part
    Given src/message-id/index.ts
    When esbuild bundles it alone as ESM for a neutral platform, with zod external
    Then its inputs include it, and every input is under src/message-id/ or src/encoding/

  @criterion-NFR-MAIL-001-c3
  Scenario: The document part bundled alone includes nothing of another part
    Given src/document/index.ts
    When esbuild bundles it alone as ESM for a neutral platform, with zod external
    Then its inputs include it, and every input is under src/document/ or src/encoding/

  @criterion-NFR-MAIL-001-c4
  Scenario: The date part bundled alone includes nothing of another part
    Given src/date/format.ts
    When esbuild bundles it alone as ESM for a neutral platform, with zod external
    Then its inputs include it, and every input is under src/date/ or src/encoding/

  @criterion-NFR-MAIL-001-c5
  Scenario: Core depends on zod alone, so no subpath can load a template plugin
    Given packages/core/package.json
    When its dependencies are read
    Then they are exactly zod

  @criterion-NFR-MAIL-001-c6
  Scenario: The receive part bundled alone includes nothing of another part but the UUIDv7 file
    Given src/receive/index.ts
    When esbuild bundles it alone as ESM for a neutral platform, with zod external
    Then its inputs include it, and every input is under src/receive/ or is src/message-id/uuidv7.ts

  @criterion-NFR-MAIL-001-c7
  Scenario: The masked part bundled alone includes nothing of another part but receive
    Given src/masked/index.ts
    When esbuild bundles it alone as ESM for a neutral platform, with zod external
    Then its inputs include it, and every input is under src/masked/ or is src/receive/recipient.ts

  @criterion-NFR-MAIL-001-c8
  Scenario: @rafters/mail-cloudflare depends on @rafters/mail and zod alone
    Given packages/cloudflare/package.json
    When its dependencies are read
    Then they are exactly @rafters/mail and zod

  @criterion-NFR-MAIL-001-c9
  Scenario: The read part bundled alone includes nothing of another part
    Given src/read/index.ts
    When esbuild bundles it alone as ESM for a neutral platform, with zod external
    Then its inputs include it, and every input is under src/read/

  @criterion-NFR-MAIL-001-c10
  Scenario: The imap part bundled alone includes nothing of another part but read
    Given src/imap/index.ts
    When esbuild bundles it alone as ESM for a neutral platform, with zod external
    Then its inputs include it, and every input is under src/imap/ or src/read/

  @criterion-NFR-MAIL-001-c11
  Scenario: The send part bundled alone includes nothing of another part
    Given src/send/index.ts
    When esbuild bundles it alone as ESM for a neutral platform, with zod external
    Then its inputs include it, and every input is under src/send/

  @criterion-NFR-MAIL-001-c12
  Scenario: @rafters/mail-resend depends on @rafters/mail and zod alone
    Given packages/resend/package.json
    When its dependencies are read
    Then they are exactly @rafters/mail and zod

  @criterion-NFR-MAIL-001-c13
  Scenario: The submit part bundled alone holds only the parts the form names and zod
    Given src/submit/index.ts
    When esbuild bundles it alone as ESM for a neutral platform, with zod external
    Then its inputs include it, and every input is under src/submit/, src/read/, src/message/, src/address/, src/document/, src/encoding/, src/date/ or src/message-id/, or is src/receive/digest.ts, src/receive/recipient.ts or src/send/unsafe.ts
