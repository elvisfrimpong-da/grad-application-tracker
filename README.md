# GradPath

A small, responsive graduate application tracker built with plain HTML, CSS, and JavaScript. Open applications, update the checklist, add recommender names and deadlines, and keep program and application links together.

## Privacy and storage

- Your starter file is encrypted with AES-GCM and kept separately from this public repository. The website reads it locally in your browser; it is not uploaded to the website.
- Choose **Set a password I can remember** on the sign-in page, select the original access phrase file, and set a new password. On a new device, also choose the starter file or an exported backup. Neither file is stored in this repository.
- When you change your password, the browser encrypts the existing tracker again with a new key and saves the previous encrypted copy locally. The password is never sent to the site or stored in the repository.
- Download a new encrypted backup after changing your password. Older backup files still require the password or access phrase that was active when they were created.
- Decryption occurs in the browser. Changes are encrypted and stored in that browser's local storage. The website and repository do not receive application edits.
- Use **Export backup** to save an encrypted backup before clearing browser data or changing devices. On the other device, choose the backup on the sign-in screen and enter the password used to create it.
- This is an independent snapshot. Changes do not update Google Sheets, and changes in the Sheet do not automatically update the tracker.
- Program and application links should be checked before use. Search links are labeled as such when a direct page was not available.

Serve this directory from HTTPS or from a local development server. No build step or installation is required. A modern browser with Web Crypto is needed.

## Gmail updates

- Gmail access is optional and uses the `gmail.readonly` scope. GradPath reads likely application-related messages directly from Gmail in the unlocked browser; an access token is kept in memory only. Saved message snippets and suggested actions are included in the encrypted local tracker and encrypted backups.
- Set up a Google Cloud project, enable the Gmail API, configure an External OAuth consent screen in Testing, add the user's Google account as a test user and add the Gmail read-only scope. Create a Web application OAuth client with `https://elvisfrimpong-da.github.io` as an authorized JavaScript origin. Save the client ID in GradPath and grant read-only access through Google. A client secret is not used. Google may show an unverified-app warning for a personal testing project.
- It checks every ten minutes only while the page is open and the short-lived Google session is active. After closing the page or token expiration, reconnect to resume checking. It does not run in the background while the tracker is closed.
- The initial check searches the last 180 days, with a maximum of 300 candidate messages per check. Gmail requests are paced and matching updates are saved in batches, so the first check may take a few minutes. Later checks include an overlap. School and content matching is approximate and can miss messages or make incorrect matches; review the original message and portal. Suggestions are rule-based and do not establish an admission decision.
- No email is sent, changed, deleted, or marked read. The application status never changes automatically. Adding a suggested action to the to-do list requires a click.

## School research import

- The Applications screen accepts a separate `gradpath-school-research-v1` JSON research file. Records are matched by existing application ID, school and program. Research is shown as a dated, sourced snapshot inside matching application details and is encrypted with the tracker. The import leaves existing application status, notes, fees and tasks intact.
- Verify dates for the relevant intake and international applicant category on the linked official pages. Importing a research file does not update the source spreadsheet.
