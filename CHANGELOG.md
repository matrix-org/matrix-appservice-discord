3.0.0 (2022-08-12)
==================

Bugfixes
--------

- Make sure we don't lose errors thrown when checking usage limits. ([\#823](https://github.com/matrix-org/matrix-appservice-discord/issues/823))
- Fix Docker instances not starting due to being unable to load a dynamic library in the latest unstable image. ([\#828](https://github.com/matrix-org/matrix-appservice-discord/issues/828))
- Remove matrix.to hyperlinks when relaying non-Discord user mentions to Discord.
  Fix mentioning Matrix users in Discord. ([\#829](https://github.com/matrix-org/matrix-appservice-discord/issues/829))


Deprecations and Removals
-------------------------

- Minimum required Node.js version is now 16. ([\#825](https://github.com/matrix-org/matrix-appservice-discord/issues/825))


Internal Changes
----------------

- Remove unused variables. ([\#657](https://github.com/matrix-org/matrix-appservice-discord/issues/657))
- Add workflow for building docker images, and push new docker images to ghcr.io. ([\#826](https://github.com/matrix-org/matrix-appservice-discord/issues/826))
- Remove `git config` workaround to pull a dependency from github.com. ([\#830](https://github.com/matrix-org/matrix-appservice-discord/issues/830))


2.0.0 (2022-08-05)
==================

Improved Documentation
----------------------

- Update `CONTRIBUTING.md` guide to reference the newly-updated guide for all of the matrix.org bridge repos. ([\#794](https://github.com/matrix-org/matrix-appservice-discord/issues/794))


Deprecations and Removals
-------------------------

- Node.JS 12 is now unsupported, please upgrade to Node.JS 14 or later. Node.JS 16 becomes the new default version. ([\#811](https://github.com/matrix-org/matrix-appservice-discord/issues/811))


Internal Changes
----------------

- Add automatic changelog generation via [Towncrier](https://github.com/twisted/towncrier). ([\#787](https://github.com/matrix-org/matrix-appservice-discord/issues/787))
- Use `yarn` instead of `npm` for package management and scripts. ([\#796](https://github.com/matrix-org/matrix-appservice-discord/issues/796))
- Add new CI workflow to check for signoffs. ([\#818](https://github.com/matrix-org/matrix-appservice-discord/issues/818))
