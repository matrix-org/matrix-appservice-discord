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
