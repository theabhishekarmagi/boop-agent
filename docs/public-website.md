# Public website

The existing frontend serves `/` (homepage), `/privacy` (privacy policy), and
`/terms` (terms of service). `/terms-of-service` is an alias. They render without
mounting the Convex/authentication provider, so visitors and reviewers do not
need to sign in. The login page also links to these documents.

Content lives in `debug/src/components/PublicPages.tsx`, with scoped styles in
`debug/src/public.css`. The design follows the supplied reference: a white
background, Boop mascot, large serif copy, a single login call to action, and
plain footer navigation. Existing dashboard and authentication routes remain.

## Policy review before public launch

The privacy and terms text is an initial draft for the operator to review,
not evidence of Google verification or a legal/compliance audit. Contact is
currently `hello.peshi@gmail.com`, the operator-selected public support contact.
Confirm that this is the intended public support inbox and identify the legal
operator before launch. Confirm retention, deletion handling, subprocessors,
AI-provider data-use settings, and the age requirement against actual operation.
The Google-data commitments must also be honored by provider configurations.
Do not claim a fixed deletion deadline, certification, Google approval, or
universal tool coverage on the basis of these pages.

Deployed to the existing AWS services on 2026-10-24 in release `4336f91`:
https://deposit-primary-pottery-picnic.trycloudflare.com/ (and `/privacy`, `/terms`).
All three public pages were checked in the browser; the support links use
`hello.peshi@gmail.com`. Public routes and health return HTTP 200; anonymous
integration API requests still return HTTP 401. The existing tunnel was preserved.
Keep the tunnel running during future web updates so its temporary hostname does not change.
Use a domain the operator owns and can verify for Google production verification.

References consulted when drafting Google data disclosures:
- https://developers.google.com/terms/api-services-user-data-policy
- https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification
