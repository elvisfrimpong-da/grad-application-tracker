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
